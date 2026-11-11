import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, access, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';

// Bounded pilot tool: authenticated plaintext stays in memory, never in a temp file.
const limit = 256 * 1024 * 1024;
const aad = Buffer.from('meetwell-database-backup-v1');
const roles = [
  'meetwell_identity',
  'meetwell_app',
  'meetwell_safety',
  'meetwell_learning',
  'meetwell_ops',
  'meetwell_worker',
];
function keyBytes(key: string) {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== key || new Set(bytes).size < 16)
    throw new Error('BACKUP_ENCRYPTION_KEY must be a separately generated 256-bit base64 key');
  return bytes;
}
async function binary(program: 'pg_dump' | 'pg_restore') {
  const executable = `${program}${process.platform === 'win32' ? '.exe' : ''}`;
  if (process.env.PG_BIN_DIR) return join(resolve(process.env.PG_BIN_DIR), executable);
  const local = resolve('.local/tools/pgsql/bin', executable);
  try {
    await access(local);
    return local;
  } catch {
    return executable;
  }
}
async function pg(program: 'pg_dump' | 'pg_restore', url: string, args: string[], input?: Buffer) {
  const connection = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol))
    throw new Error('PostgreSQL URL required');
  for (const name of connection.searchParams.keys())
    if (name !== 'sslmode') throw new Error('Unsupported backup database option');
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOME',
  ])
    if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, {
    PGHOST: connection.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: connection.port || '5432',
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '10',
    PGSSLMODE: connection.searchParams.get('sslmode') ?? 'prefer',
  });
  const executable = await binary(program);
  return new Promise<Buffer>((done, reject) => {
    const child = spawn(executable, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.stderr.resume(); // Never expose server SQL, connection details or dump contents.
    child.stdin.on('error', () => {
      /* exit status is authoritative */
    });
    child.on('error', () => reject(new Error(`${program} could not start`)));
    child.on('close', (code) =>
      code === 0 && !overflow
        ? done(Buffer.concat(chunks))
        : reject(new Error(`${program} failed or exceeded the 256 MiB pilot limit`)),
    );
    child.stdin.end(input);
  });
}
export async function backupDatabase(url: string, archive: string, key: string) {
  const bytes = keyBytes(key);
  const dump = await pg('pg_dump', url, ['--format=custom', '--no-owner', '--no-password']);
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', bytes, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(dump), cipher.final()]);
  await writeFile(archive, Buffer.concat([aad, iv, cipher.getAuthTag(), ciphertext]), {
    flag: 'wx',
    mode: 0o600,
  });
}
export async function restoreDatabase(clusterUrl: string, archive: string, key: string) {
  const bytes = keyBytes(key);
  if ((await stat(archive)).size > limit + aad.length + 28)
    throw new Error('Backup exceeds the pilot limit');
  const data = await readFile(archive);
  if (!data.subarray(0, aad.length).equals(aad)) throw new Error('Unsupported backup format');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    bytes,
    data.subarray(aad.length, aad.length + 12),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(data.subarray(aad.length + 12, aad.length + 28));
  let dump: Buffer;
  try {
    dump = Buffer.concat([decipher.update(data.subarray(aad.length + 28)), decipher.final()]);
  } catch {
    throw new Error('Backup authentication failed');
  }
  // Authenticate the complete archive BEFORE creating a database or executing restored SQL.
  const cluster = new Pool({ connectionString: clusterUrl, connectionTimeoutMillis: 10000 });
  const database = `meetwell_restore_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(clusterUrl);
  target.pathname = `/${database}`;
  try {
    const existingRoles = await cluster.query<{ rolname: string; safe: boolean }>(
      `SELECT rolname, NOT (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS safe FROM pg_roles WHERE rolname=ANY($1)`,
      [roles],
    );
    if (existingRoles.rows.length !== roles.length || existingRoles.rows.some((r) => !r.safe))
      throw new Error('Provision the six non-login Meetwell privilege roles before restoring');
    await cluster.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    // A fresh generated target only. Never clean/drop/overwrite an existing database.
    await pg(
      'pg_restore',
      target.toString(),
      [
        '--dbname',
        database,
        '--no-owner',
        '--no-password',
        '--exit-on-error',
        '--single-transaction',
      ],
      dump,
    );
    return database;
  } catch {
    throw new Error(
      `Restore failed; quarantine any fresh database named ${database}. Source database was not modified.`,
    );
  } finally {
    await cluster.end();
  }
}
