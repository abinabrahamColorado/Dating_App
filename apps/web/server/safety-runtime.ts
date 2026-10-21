import { Pool } from 'pg';
import { SafetyStore } from '@meetwell/db/safety';
import { store, requireDevelopmentEnrollment } from './runtime';
let cached: SafetyStore | undefined;
export function safetyStore() {
  if (!cached) {
    requireDevelopmentEnrollment();
    const url = process.env.SAFETY_DATABASE_URL,
      key = process.env.SAFETY_ENCRYPTION_KEY;
    if (!url || !key) throw new Error('SAFETY_UNAVAILABLE');
    cached = new SafetyStore(
      store(),
      new Pool({
        connectionString: url,
        max: 5,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
      }),
      key,
    );
  }
  return cached;
}
