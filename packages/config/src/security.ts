/** Spec P22: explicit local-only plaintext exception; no values in diagnostics. */
type Environment = Record<string, string | undefined>;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export const exampleSecrets = ['local-development-only', 'local-worker-only', 'local-storage-only'];
export function isLocalRuntime(env: Environment): boolean {
  if (env.APP_MODE !== 'local') return false;
  try {
    return loopback.has(new URL(env.APP_ORIGIN ?? '').hostname);
  } catch {
    return false;
  }
}
function invalid(name: string): never {
  throw new Error(`Invalid server configuration: ${name}`);
}
export function smtpOptions(env: Environment) {
  const local = isLocalRuntime(env);
  const mode = env.SMTP_TLS ?? (local ? 'none' : '');
  const host = env.SMTP_HOST ?? (local ? '127.0.0.1' : '');
  const port = Number(env.SMTP_PORT ?? (local ? '1025' : ''));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) invalid('SMTP_HOST/SMTP_PORT');
  if (!['implicit', 'starttls', 'none'].includes(mode))
    invalid('SMTP_TLS (implicit or starttls required outside local mode)');
  if (mode === 'none' && (!local || !loopback.has(host)))
    invalid('SMTP_TLS (plaintext is loopback-local only)');
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) invalid('SMTP_USER/SMTP_PASS');
  return {
    host,
    port,
    secure: mode === 'implicit',
    requireTLS: mode === 'starttls',
    ignoreTLS: mode === 'none',
    tls: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true },
    ...(env.SMTP_USER && env.SMTP_PASS
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
      : {}),
    logger: false,
    debug: false,
  };
}
function strongSecret(name: string, value: string | undefined) {
  if (!value || value !== value.trim() || value.length < 24 || exampleSecrets.includes(value))
    invalid(name);
}
export function assertRuntimeSecurity(env: Environment, role: 'web' | 'worker') {
  if (!['local', 'test', 'staging', 'production'].includes(env.APP_MODE ?? '')) invalid('APP_MODE');
  if (env.APP_MODE === 'local' && !isLocalRuntime(env))
    invalid('APP_ORIGIN (local requires loopback)');
  smtpOptions(env);
  if (isLocalRuntime(env)) return;
  let origin: URL;
  try {
    origin = new URL(env.APP_ORIGIN ?? '');
  } catch {
    return invalid('APP_ORIGIN');
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password)
    invalid('APP_ORIGIN (HTTPS required)');
  const keys = [
    'IDENTITY_ENCRYPTION_KEY',
    'APP_ENCRYPTION_KEY',
    'LOOKUP_KEY',
    ...(role === 'web' ? ['MEDIA_ENCRYPTION_KEY', 'SAFETY_ENCRYPTION_KEY'] : []),
  ];
  const unique = new Set<string>();
  for (const name of keys) {
    const value = env[name] ?? '';
    const decoded = Buffer.from(value, 'base64');
    if (
      decoded.length !== 32 ||
      decoded.toString('base64') !== value ||
      new Set(decoded).size < 16 ||
      unique.has(value)
    )
      invalid(name);
    unique.add(value);
  }
  const urls = [
    'IDENTITY_DATABASE_URL',
    'APP_DATABASE_URL',
    ...(role === 'web' ? ['OPS_DATABASE_URL', 'SAFETY_DATABASE_URL'] : ['WORKER_DATABASE_URL']),
  ];
  for (const name of new Set([
    ...urls,
    ...Object.keys(env).filter((k) => k.endsWith('_DATABASE_URL') && env[k]),
  ])) {
    try {
      const url = new URL(env[name] ?? '');
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) invalid(name);
      // pg's query parameters override URL authority. Only TLS mode is supported;
      // otherwise a checked password/host/user could differ from the actual connection.
      if ([...url.searchParams.keys()].some((key) => key !== 'sslmode')) invalid(name);
      strongSecret(name, decodeURIComponent(url.password));
    } catch {
      invalid(name);
    }
  }
  if (role === 'web') {
    strongSecret('MEDIA_SECRET_KEY', env.MEDIA_SECRET_KEY);
    if (!env.MEDIA_ACCESS_KEY || env.MEDIA_ACCESS_KEY === 'meetwell-local')
      invalid('MEDIA_ACCESS_KEY');
  }
  for (const name of ['SMTP_PASS', 'MINIO_ROOT_PASSWORD', 'BACKUP_ENCRYPTION_KEY']) {
    if (env[name] !== undefined) strongSecret(name, env[name]);
  }
}
