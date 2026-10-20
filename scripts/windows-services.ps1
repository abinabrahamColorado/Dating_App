param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('setup', 'start', 'stop', 'status')]
  [string]$Action
)

# Project-local Windows development only. No administrator rights, global PATH
# changes, service registration, or data deletion. Spec P22; DEC-022.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Windows PowerShell launched by PowerShell 7 can inherit only the latter's
# module search path. Restore this host's built-in modules for archive/hash tools.
$env:PSModulePath = "$(Join-Path $PSHOME 'Modules');$env:PSModulePath"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localRoot = Join-Path $projectRoot '.local'
$pgRoot = Join-Path $localRoot 'tools\pgsql'
$pgData = Join-Path $localRoot 'data\postgres'
$logRoot = Join-Path $localRoot 'logs'
$pidRoot = Join-Path $localRoot 'run'
$binRoot = Join-Path $localRoot 'bin'
$pgCtl = Join-Path $pgRoot 'bin\pg_ctl.exe'

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

function Get-VerifiedArchive([string]$Name, $Artifact) {
  $destination = Join-Path $localRoot "cache\$Name.zip"
  if (!(Test-Path -LiteralPath $destination)) {
    Write-Host "Downloading pinned $Name..."
    Invoke-WebRequest -Uri $Artifact.url -OutFile $destination -UseBasicParsing
  }
  $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
  if ($actual -ne $Artifact.sha256) {
    throw "Checksum mismatch for $Name. Refusing to extract or execute it."
  }
  return $destination
}

function Get-OwnedProcess([string]$Name, [string]$Executable) {
  $pidFile = Join-Path $pidRoot "$Name.pid"
  if (Test-Path -LiteralPath $pidFile) {
    $savedProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $running = Get-Process -Id $savedProcessId -ErrorAction SilentlyContinue
    if ($running -and $running.Path -eq $Executable) { return $running }
  }
  return $null
}

function Assert-FreePorts([int[]]$Ports) {
  foreach ($servicePort in $Ports) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $servicePort)
    try { $listener.Start() }
    catch { throw "Port $servicePort is occupied. Stop the conflicting service before continuing." }
    finally { $listener.Stop() }
  }
}

function Start-OwnedProcess([string]$Name, [string]$Executable, [string[]]$Arguments, [int[]]$Ports) {
  if (Get-OwnedProcess $Name $Executable) { return }
  Assert-FreePorts $Ports
  $started = Start-Process -FilePath $Executable -ArgumentList $Arguments `
    -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logRoot "$Name.stdout.log") `
    -RedirectStandardError (Join-Path $logRoot "$Name.stderr.log")
  Set-Content -LiteralPath (Join-Path $pidRoot "$Name.pid") -Value $started.Id -Encoding ascii
}

function Wait-Http([string]$Url) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "Service did not become healthy: $Url. Inspect .local/logs."
}

if ($Action -eq 'setup') {
  foreach ($directory in @('cache', 'tools', 'bin', 'src', 'data', 'data\minio', 'logs', 'run', 'go-cache', 'go-path')) {
    New-Item -ItemType Directory -Path (Join-Path $localRoot $directory) -Force | Out-Null
  }
  $artifacts = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-artifacts.json') -Raw | ConvertFrom-Json
  $archives = @{}
  foreach ($entry in $artifacts.PSObject.Properties) {
    $archives[$entry.Name] = Get-VerifiedArchive $entry.Name $entry.Value
  }
  if (!(Test-Path -LiteralPath $pgCtl)) {
    Expand-Archive -LiteralPath $archives.postgresql -DestinationPath (Join-Path $localRoot 'tools') -Force
  }
  if (!(Test-Path -LiteralPath (Join-Path $pgRoot 'share\extension\postgis.control'))) {
    Expand-Archive -LiteralPath $archives.postgis -DestinationPath (Join-Path $localRoot 'tools\postgis') -Force
    $postgisRoot = Join-Path $localRoot 'tools\postgis\postgis-bundle-pg16-3.6.2x64'
    foreach ($folder in @('bin', 'lib', 'share')) {
      Get-ChildItem -LiteralPath (Join-Path $postgisRoot $folder) -Force |
        Copy-Item -Destination (Join-Path $pgRoot $folder) -Recurse -Force
    }
  }
  $goExe = Join-Path $localRoot 'tools\go\bin\go.exe'
  if (!(Test-Path -LiteralPath $goExe)) {
    Expand-Archive -LiteralPath $archives.go -DestinationPath (Join-Path $localRoot 'tools') -Force
  }
  if (!(Test-Path -LiteralPath (Join-Path $binRoot 'mailpit.exe'))) {
    Expand-Archive -LiteralPath $archives.mailpit -DestinationPath $binRoot -Force
  }
  $minioExe = Join-Path $binRoot 'minio.exe'
  if (!(Test-Path -LiteralPath $minioExe)) {
    $minioSource = Join-Path $localRoot 'src\minio'
    $minioCommit = '9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a'
    if (!(Test-Path -LiteralPath (Join-Path $minioSource '.git'))) {
      Invoke-Checked 'git' @('clone', '--filter=blob:none', '--no-checkout', 'https://github.com/minio/minio.git', $minioSource)
    }
    Invoke-Checked 'git' @('-C', $minioSource, 'fetch', '--depth', '1', 'origin', $minioCommit)
    Invoke-Checked 'git' @('-C', $minioSource, 'checkout', '--detach', $minioCommit)
    $previousGo = @{}
    foreach ($variable in @('GOCACHE', 'GOPATH', 'CGO_ENABLED')) {
      $previousGo[$variable] = [Environment]::GetEnvironmentVariable($variable, 'Process')
    }
    try {
      $env:GOCACHE = Join-Path $localRoot 'go-cache'
      $env:GOPATH = Join-Path $localRoot 'go-path'
      $env:CGO_ENABLED = '0'
      Push-Location $minioSource
      try { Invoke-Checked $goExe @('build', '-trimpath', '-o', $minioExe, '.') }
      finally { Pop-Location }
    } finally {
      foreach ($variable in $previousGo.Keys) {
        [Environment]::SetEnvironmentVariable($variable, $previousGo[$variable], 'Process')
      }
    }
  }
  if (!(Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
    $passwordFile = Join-Path $pidRoot 'init-password.txt'
    try {
      Set-Content -LiteralPath $passwordFile -Value 'local-development-only' -Encoding ascii
      Invoke-Checked (Join-Path $pgRoot 'bin\initdb.exe') @(
        '-D', $pgData, '-U', 'meetwell_dev', '--auth=scram-sha-256', '--encoding=UTF8',
        '--locale=C', "--pwfile=$passwordFile"
      )
    } finally {
      if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
    }
    Add-Content -LiteralPath (Join-Path $pgData 'postgresql.conf') -Value @'

# Meetwell synthetic development; local machine access only.
listen_addresses = '127.0.0.1'
port = 55432
log_statement = 'none'
log_parameter_max_length = 0
log_parameter_max_length_on_error = 0
'@
  }
  if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) {
    $environment = Get-Content -LiteralPath (Join-Path $projectRoot '.env.example') -Raw
    [IO.File]::WriteAllText((Join-Path $projectRoot '.env'), $environment.Replace(':5432/', ':55432/'))
  }
  Write-Host 'Setup complete. Existing .env and database data were preserved.'
  & $PSCommandPath -Action start
  Invoke-Checked 'corepack.cmd' @('pnpm', 'exec', 'tsx', (Join-Path $PSScriptRoot 'bootstrap-windows-db.ts'))
  exit
}

if (!(Test-Path -LiteralPath $pgCtl)) { throw 'Run the setup action first.' }
if ($Action -eq 'status') {
  & $pgCtl '-D' $pgData 'status'
  foreach ($name in @('minio', 'mailpit')) {
    $running = Get-OwnedProcess $name (Join-Path $binRoot "$name.exe")
    Write-Host "$name running: $([bool]$running)"
  }
  exit
}
if ($Action -eq 'stop') {
  & $pgCtl '-D' $pgData 'status' *> $null
  if ($LASTEXITCODE -eq 0) { Invoke-Checked $pgCtl @('-D', $pgData, '-m', 'fast', '-w', 'stop') }
  foreach ($name in @('minio', 'mailpit')) {
    $running = Get-OwnedProcess $name (Join-Path $binRoot "$name.exe")
    if ($running) { Stop-Process -InputObject $running }
  }
  Write-Host 'Project services stopped. Data preserved.'
  exit
}

& $pgCtl '-D' $pgData 'status' *> $null
if ($LASTEXITCODE -ne 0) {
  Assert-FreePorts @(55432)
  # pg_ctl starts a detached server. Keep both the helper and server hidden.
  $pgStart = Start-Process -FilePath $pgCtl -WindowStyle Hidden -PassThru `
    -ArgumentList @('-D', "`"$pgData`"", '-l', "`"$(Join-Path $logRoot 'postgres.log')`"", '-w', 'start') `
    -RedirectStandardOutput (Join-Path $logRoot 'pg-start.stdout.log') `
    -RedirectStandardError (Join-Path $logRoot 'pg-start.stderr.log')
  # Start-Process -Wait also waits for the long-lived database descendant.
  # Wait only for pg_ctl itself, which exits when the server is ready.
  if (!$pgStart.WaitForExit(60000)) { throw 'PostgreSQL startup timed out. Inspect .local/logs.' }
  if ($null -ne $pgStart.ExitCode -and $pgStart.ExitCode -ne 0) {
    throw 'PostgreSQL failed to start. Inspect .local/logs.'
  }
  Invoke-Checked (Join-Path $pgRoot 'bin\pg_isready.exe') @('-h', '127.0.0.1', '-p', '55432', '-U', 'meetwell_dev')
}
$previousMinioUser = $env:MINIO_ROOT_USER
$previousMinioPassword = $env:MINIO_ROOT_PASSWORD
try {
  $env:MINIO_ROOT_USER = 'meetwell-local'
  $env:MINIO_ROOT_PASSWORD = 'local-storage-only'
  Start-OwnedProcess 'minio' (Join-Path $binRoot 'minio.exe') @(
    'server', "`"$(Join-Path $localRoot 'data\minio')`"", '--address', '127.0.0.1:9000',
    '--console-address', '127.0.0.1:9001'
  ) @(9000, 9001)
} finally {
  $env:MINIO_ROOT_USER = $previousMinioUser
  $env:MINIO_ROOT_PASSWORD = $previousMinioPassword
}
Start-OwnedProcess 'mailpit' (Join-Path $binRoot 'mailpit.exe') @(
  '--listen', '127.0.0.1:8025', '--smtp', '127.0.0.1:1025'
) @(8025, 1025)
Wait-Http 'http://127.0.0.1:9000/minio/health/live'
Wait-Http 'http://127.0.0.1:8025/readyz'
Write-Host 'Healthy: PostgreSQL 55432; MinIO 9000/9001; Mailpit 1025/8025 (loopback only).'
