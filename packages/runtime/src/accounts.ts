import { Pool } from 'pg';
import { AccountStore } from '@meetwell/db/accounts';
import { Envelope } from '@meetwell/db/encryption';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
export function appOrigin() {
  return new URL(required('APP_ORIGIN')).origin;
}
/** M1 is usable only on loopback with synthetic data. Release gate is deliberately fail-closed. */
export function requireDevelopmentEnrollment() {
  const origin = new URL(appOrigin());
  if (
    !['local', 'test'].includes(process.env.APP_MODE ?? '') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  )
    throw new Error('ENROLLMENT_DISABLED');
}
let cached: AccountStore | undefined;
export function store(): AccountStore {
  if (!cached) {
    requireDevelopmentEnrollment();
    const pool = (name: string) =>
      new Pool({
        connectionString: required(name),
        max: 5,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
      });
    cached = new AccountStore({
      identity: pool('IDENTITY_DATABASE_URL'),
      app: pool('APP_DATABASE_URL'),
      ops: pool('OPS_DATABASE_URL'),
      identityKey: required('IDENTITY_ENCRYPTION_KEY'),
      appKey: required('APP_ENCRYPTION_KEY'),
      lookupKey: required('LOOKUP_KEY'),
    });
  }
  return cached;
}
export function mediaCipher() {
  return new Envelope(required('MEDIA_ENCRYPTION_KEY'));
}
let workerCached: AccountStore | undefined;
/** Workers consume approved outbox intents; they have no operator/safety login. */
export function workerStore(): AccountStore {
  if (!workerCached) {
    requireDevelopmentEnrollment();
    const app = new Pool({ connectionString: required('APP_DATABASE_URL'), max: 5 });
    workerCached = new AccountStore({
      identity: new Pool({ connectionString: required('IDENTITY_DATABASE_URL'), max: 5 }),
      app,
      ops: app, // No ops privileges: staff methods fail closed in this process.
      identityKey: required('IDENTITY_ENCRYPTION_KEY'),
      appKey: required('APP_ENCRYPTION_KEY'),
      lookupKey: required('LOOKUP_KEY'),
    });
  }
  return workerCached;
}
