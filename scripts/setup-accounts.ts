import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { parse } from 'dotenv';
import { migrate } from '../packages/db/src/migrate';
import { setupLocalStorage } from '../apps/web/server/setup-storage';

const path = '.env';
const existing = await readFile(path, 'utf8').catch(() => '');
const values = { ...parse(existing), ...process.env };
const migration = values.MIGRATION_DATABASE_URL ?? values.TEST_DATABASE_URL;
const test = values.TEST_DATABASE_URL;
if (!migration || !test)
  throw new Error('Local migration and isolated test database URLs are required');
for (const url of [migration, test]) {
  if (
    !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    !/_(dev|test)$/.test(new URL(url).pathname)
  )
    throw new Error('Setup is restricted to local development/test databases');
  await migrate(url);
}
const additions: Record<string, string> = {};
const set = (name: string, value: string) => {
  additions[name] = value;
  process.env[name] = value;
};
const admin = new Pool({ connectionString: migration });
try {
  for (const boundary of ['identity', 'app', 'ops', 'safety'] as const) {
    const envName = `${boundary.toUpperCase()}_DATABASE_URL`;
    const roleName = `meetwell_${boundary}_dev`;
    const connection = new URL(migration);
    const old = values[envName] ? new URL(values[envName]!) : null;
    const password = old ? decodeURIComponent(old.password) : randomBytes(24).toString('base64url');
    const found = await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [roleName]);
    if (!found.rowCount)
      await admin.query(
        `CREATE ROLE ${roleName} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
    // Fixed identifiers; password is generated locally and quoted as a SQL literal.
    await admin.query(`ALTER ROLE ${roleName} PASSWORD '${password.replaceAll("'", "''")}'`);
    await admin.query(`GRANT meetwell_${boundary} TO ${roleName}`);
    connection.username = roleName;
    connection.password = password;
    set(envName, connection.toString());
    connection.pathname = new URL(test).pathname;
    set(`TEST_${envName}`, connection.toString());
  }
} finally {
  await admin.end();
}
for (const key of [
  'IDENTITY_ENCRYPTION_KEY',
  'APP_ENCRYPTION_KEY',
  'MEDIA_ENCRYPTION_KEY',
  'SAFETY_ENCRYPTION_KEY',
  'LOOKUP_KEY',
]) {
  set(key, values[key] ?? randomBytes(32).toString('base64'));
}
set('APP_MODE', 'local');
set('APP_ORIGIN', values.APP_ORIGIN ?? 'http://localhost:3000');
set('MEDIA_ACCESS_KEY', values.MEDIA_ACCESS_KEY ?? values.MINIO_ROOT_USER ?? 'meetwell-local');
set(
  'MEDIA_SECRET_KEY',
  values.MEDIA_SECRET_KEY ?? values.MINIO_ROOT_PASSWORD ?? 'local-storage-only',
);
set('MEDIA_BUCKET', 'meetwell-private');
await setupLocalStorage();
// Replace only keys owned by this setup; preserve all other configuration and comments.
const lines = existing
  .split(/\r?\n/)
  .filter((line) => !Object.keys(additions).some((key) => line.startsWith(`${key}=`)));
await writeFile(
  path,
  `${lines.join('\n').trim()}\n\n# M1 local accounts. Generated secrets; never commit.\n${Object.entries(
    additions,
  )
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`,
);
process.stdout.write(
  'Local accounts ready: separate runtime logins, encryption keys, and private media buckets. Secrets were saved only in ignored .env.\n',
);
