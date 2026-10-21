import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { AccountStore } from '../../packages/db/src/accounts';
import { hashToken } from '../../packages/db/src/encryption';
import { migrate } from '../../packages/db/src/migrate';
import { accountConfig as c } from '../../packages/config/src/accounts';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Isolated real test database required');
const admin = new Pool({ connectionString: url });
const scopedUrl = new URL(url);
scopedUrl.searchParams.set('options', '-c role=meetwell_identity');
const identity = new Pool({ connectionString: scopedUrl.toString() });
// Delivery must work with only the identity role; unused app/ops pools grant nothing extra.
const store = new AccountStore({
  identity,
  app: identity,
  ops: identity,
  identityKey: randomBytes(32).toString('base64'),
  appKey: randomBytes(32).toString('base64'),
  lookupKey: randomBytes(32).toString('base64'),
});
const fixtureIds: string[] = [];
beforeAll(async () => {
  await migrate(url);
});
afterEach(async () => {
  await admin.query('DELETE FROM identity.magic_links WHERE id=ANY($1::uuid[])', [fixtureIds]);
  fixtureIds.length = 0;
});
afterAll(async () => {
  await Promise.all([identity.end(), admin.end()]);
});
async function pending(corrupt = false) {
  const id = randomUUID(),
    token = randomUUID(),
    email = `${id}@synthetic.invalid`;
  fixtureIds.push(id);
  await identity.query(
    `INSERT INTO identity.magic_links
      (id,email_lookup,payload_cipher,token_hash,browser_hash,expires_at,created_at)
     VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes',$6)`,
    [
      id,
      store.lookup(email),
      corrupt ? 'synthetic-corruption' : store.identityCipher.seal({ email, token }, `magic:${id}`),
      hashToken(token),
      hashToken(randomUUID()),
      new Date(Date.UTC(2000, 0, 1, 0, 0, fixtureIds.length)),
    ],
  );
  return { id, email };
}
async function state(id: string) {
  return (
    await identity.query<{
      attempts: number;
      sent_at: Date | null;
      delayed: boolean;
    }>(
      'SELECT attempts,sent_at,next_attempt_at>now() AS delayed FROM identity.magic_links WHERE id=$1',
      [id],
    )
  ).rows[0]!;
}
it('Spec P22 auth outbox isolates corrupt and failed messages, commits successes and delays retries', async () => {
  const first = await pending(),
    corrupt = await pending(true),
    failed = await pending(),
    last = await pending();
  const sent: string[] = [];
  await store.deliverMagicLinks(async (email) => {
    if (email === failed.email) throw new Error('Synthetic SMTP failure');
    sent.push(email);
  });
  expect(sent).toEqual([first.email, last.email]);
  for (const row of [corrupt, failed])
    expect(await state(row.id)).toEqual({ attempts: 1, sent_at: null, delayed: true });
  for (const row of [first, last]) {
    expect((await state(row.id)).sent_at).toBeInstanceOf(Date);
    expect((await state(row.id)).attempts).toBe(1);
  }
  await store.deliverMagicLinks(async (email) => {
    sent.push(email);
  });
  expect(sent).toEqual([first.email, last.email]);
  await identity.query('UPDATE identity.magic_links SET next_attempt_at=now() WHERE id=$1', [
    failed.id,
  ]);
  await store.deliverMagicLinks(async (email) => {
    sent.push(email);
  });
  expect(sent).toEqual([first.email, last.email, failed.email]);
  expect((await state(failed.id)).attempts).toBe(2);
});
it('Spec P22 auth outbox skips expired, consumed, future and exhausted messages', async () => {
  const expired = await pending(),
    consumed = await pending(),
    delayed = await pending(),
    exhausted = await pending();
  await identity.query(
    "UPDATE identity.magic_links SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  await identity.query('UPDATE identity.magic_links SET consumed_at=now() WHERE id=$1', [
    consumed.id,
  ]);
  await identity.query(
    "UPDATE identity.magic_links SET next_attempt_at=now()+interval '1 hour' WHERE id=$1",
    [delayed.id],
  );
  await identity.query('UPDATE identity.magic_links SET attempts=$2 WHERE id=$1', [
    exhausted.id,
    c.AUTH_OUTBOX_MAX_ATTEMPTS,
  ]);
  const sent: string[] = [];
  await store.deliverMagicLinks(async (email) => {
    sent.push(email);
  });
  expect(sent).toEqual([]);
  expect((await state(exhausted.id)).attempts).toBe(c.AUTH_OUTBOX_MAX_ATTEMPTS);
});
it('Spec P22 concurrent auth runners skip a locked send and deliver each eligible row once', async () => {
  const first = await pending(),
    second = await pending();
  const sent: string[] = [];
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const unblock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = store.deliverMagicLinks(async (email) => {
    sent.push(email);
    if (email === first.email) {
      entered();
      await unblock;
    }
  });
  try {
    await started;
    await store.deliverMagicLinks(async (email) => {
      sent.push(email);
    });
    expect(sent).toEqual([first.email, second.email]);
    expect((await state(second.id)).sent_at).toBeInstanceOf(Date);
  } finally {
    release();
    await runner;
  }
  expect(sent).toEqual([first.email, second.email]);
  expect((await state(first.id)).attempts).toBe(1);
});
it('Spec P22 commit failure preserves earlier sends and exposes at-least-once SMTP on recovery', async () => {
  const first = await pending(),
    failed = await pending();
  const sent: string[] = [];
  // Inject a real deferred PostgreSQL commit failure on this synthetic row only.
  await admin.query(`CREATE FUNCTION identity.test_auth_delivery_commit() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${failed.id}'::uuid THEN RAISE EXCEPTION 'synthetic commit failure'; END IF;
      RETURN NEW;
    END $$`);
  try {
    await admin.query(`CREATE CONSTRAINT TRIGGER test_auth_delivery_commit
      AFTER UPDATE ON identity.magic_links DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION identity.test_auth_delivery_commit()`);
    await expect(
      store.deliverMagicLinks(async (email) => {
        sent.push(email);
      }),
    ).rejects.toThrow('synthetic commit failure');
    expect((await state(first.id)).sent_at).toBeInstanceOf(Date);
    expect(await state(failed.id)).toMatchObject({ sent_at: null, attempts: 0 });
  } finally {
    await admin.query('DROP TRIGGER IF EXISTS test_auth_delivery_commit ON identity.magic_links');
    await admin.query('DROP FUNCTION identity.test_auth_delivery_commit()');
  }
  await store.deliverMagicLinks(async (email) => {
    sent.push(email);
  });
  expect(sent).toEqual([first.email, failed.email, failed.email]);
  expect((await state(failed.id)).sent_at).toBeInstanceOf(Date);
});
