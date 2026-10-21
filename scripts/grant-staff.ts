import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import { emailSchema } from '../packages/core/src/accounts';
import { lookupToken } from '../packages/db/src/encryption';
// Explicit local administrative command. No public role-assignment endpoint.
const revoke = process.argv[2] === '--revoke';
const target = process.argv[revoke ? 3 : 2] ?? '';
const parsedId = z.uuid().safeParse(target);
const role = z.enum(['operator', 'safety_reviewer', 'admin']).parse(process.argv[revoke ? 4 : 3]);
const url = process.env.MIGRATION_DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_dev')
)
  throw new Error('This command is for local synthetic development only');
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const lookup = parsedId.success
    ? parsedId.data
    : lookupToken(process.env.LOOKUP_KEY!, emailSchema.parse(target));
  const member = await client.query<{ id: string }>(
    `SELECT id FROM identity.users WHERE ${parsedId.success ? 'id' : 'email_lookup'}=$1 AND registered_at IS NOT NULL`,
    [lookup],
  );
  if (!member.rowCount) throw new Error('A registered local synthetic member is required');
  const id = member.rows[0]!.id;
  await client.query(
    revoke
      ? 'DELETE FROM ops.staff WHERE member_id=$1 AND role=$2'
      : 'INSERT INTO ops.staff(member_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [id, role],
  );
  await client.query(
    'INSERT INTO ops.audit(id,actor_id,action,subject_id,request_id) VALUES($1,$2,$4,$2,$3)',
    [randomUUID(), id, randomUUID(), revoke ? 'STAFF_REVOKED' : 'STAFF_GRANTED'],
  );
  await client.query('COMMIT');
  process.stdout.write(
    revoke ? 'Local staff role revoked and audited.\n' : 'Local staff role granted and audited.\n',
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
