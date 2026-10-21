import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { AccountStore, type Authority } from '../../packages/db/src/accounts';
import { migrate } from '../../packages/db/src/migrate';
import { accountConfig as c } from '../../packages/config/src/accounts';
import { syntheticProfile, syntheticPreferences } from '../fixtures/accounts';
import { hashToken } from '../../packages/db/src/encryption';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Isolated real test database required');
const admin = new Pool({ connectionString: url });
const role = (name: string) => {
  const u = new URL(url);
  u.searchParams.set('options', `-c role=meetwell_${name}`);
  return new Pool({ connectionString: u.toString() });
};
const identity = role('identity'),
  app = role('app'),
  ops = role('ops');
const db = new AccountStore({
  identity,
  app,
  ops,
  identityKey: randomBytes(32).toString('base64'),
  appKey: randomBytes(32).toString('base64'),
  lookupKey: randomBytes(32).toString('base64'),
});
const createdMembers: string[] = [];
beforeAll(async () => {
  await migrate(url);
});
afterAll(async () => {
  // These fixtures deliberately have no S3 bytes. Keep them out of the browser review queue.
  await admin.query("UPDATE app.media SET status='REMOVED' WHERE member_id=ANY($1::uuid[])", [
    createdMembers,
  ]);
  await Promise.all([admin.end(), identity.end(), app.end(), ops.end()]);
});

async function account(register = true) {
  const email = `${randomUUID()}@synthetic.invalid`,
    browser = randomUUID();
  const id = await db.requestMagicLink(email, browser);
  const row = await identity.query<{ payload_cipher: string }>(
    'SELECT payload_cipher FROM identity.magic_links WHERE id=$1',
    [id],
  );
  const { token } = db.identityCipher.open<{ token: string }>(
    row.rows[0]!.payload_cipher,
    `magic:${id}`,
  );
  const session = await db.consumeMagicLink(token, browser);
  createdMembers.push(session.memberId);
  if (register)
    await db.register(session.memberId, {
      birthDate: '2002-01-15',
      accepted: true,
      termsVersion: c.TERMS_VERSION,
      privacyVersion: c.PRIVACY_VERSION,
    });
  const auth = (await db.authority(session.token))!;
  return { ...session, auth, email, browser, magicToken: token };
}
async function readyAccount() {
  const result = await account();
  await db.saveProfile(result.memberId, randomUUID(), 0, syntheticProfile);
  await db.savePreferences(result.memberId, randomUUID(), 0, syntheticPreferences);
  for (let i = 0; i < 2; i++) {
    const photo = await db.addPhoto(
      result.memberId,
      randomUUID(),
      `synthetic-${i}`,
      async () => {},
    );
    // Fixture administrator records approval; production paths are tested separately.
    await admin.query("UPDATE app.media SET status='APPROVED' WHERE id=$1", [photo.id]);
  }
  return result;
}
it('I-01 registration rejects underage and over-cohort dates, records versioned consent, isolates birth date', async () => {
  const user = await account(false);
  for (const birthDate of ['2015-01-01', '1900-01-01', '2000-02-30']) {
    await expect(
      db.register(user.memberId, {
        birthDate,
        accepted: true,
        termsVersion: c.TERMS_VERSION,
        privacyVersion: c.PRIVACY_VERSION,
      }),
    ).rejects.toThrow('AGE_INELIGIBLE');
  }
  await db.register(user.memberId, {
    birthDate: '2002-01-15',
    accepted: true,
    termsVersion: c.TERMS_VERSION,
    privacyVersion: c.PRIVACY_VERSION,
  });
  await expect(app.query('SELECT birth_cipher FROM identity.users')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(ops.query('SELECT email_cipher FROM identity.users')).rejects.toMatchObject({
    code: '42501',
  });
  const raw = (await admin.query('SELECT * FROM identity.users WHERE id=$1', [user.memberId]))
    .rows[0];
  expect(JSON.stringify(raw)).not.toContain('2002-01-15');
  expect(JSON.stringify(raw)).not.toContain(user.email);
  expect(
    (
      await identity.query(
        'SELECT purpose,document_version FROM identity.consents WHERE member_id=$1',
        [user.memberId],
      )
    ).rows,
  ).toHaveLength(2);
  expect(await db.authority(user.token)).toMatchObject({ registered: true });
});
it('I-19 magic links are browser-bound, expiring and consumed exactly once under a race', async () => {
  const email = `${randomUUID()}@synthetic.invalid`,
    browser = randomUUID();
  const id = await db.requestMagicLink(email, browser);
  const row = (
    await identity.query('SELECT payload_cipher FROM identity.magic_links WHERE id=$1', [id])
  ).rows[0];
  const { token } = db.identityCipher.open<{ token: string }>(row.payload_cipher, `magic:${id}`);
  await expect(db.consumeMagicLink(token, 'wrong-browser')).rejects.toThrow('INVALID_LINK');
  const results = await Promise.allSettled([
    db.consumeMagicLink(token, browser),
    db.consumeMagicLink(token, browser),
  ]);
  expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
  await expect(db.consumeMagicLink(token, browser)).rejects.toThrow('INVALID_LINK');
  await identity.query(
    "UPDATE identity.magic_links SET consumed_at=NULL,expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  await expect(db.consumeMagicLink(token, browser)).rejects.toThrow('INVALID_LINK');
});
it('I-03 preference history cannot be overwritten; racing edits and replay preserve USER statements', async () => {
  const { memberId } = await account();
  const key = randomUUID();
  expect(await db.savePreferences(memberId, key, 0, syntheticPreferences)).toEqual({ version: 1 });
  expect(await db.savePreferences(memberId, key, 0, syntheticPreferences)).toEqual({ version: 1 });
  const next = {
    ...syntheticPreferences,
    smoking: { setting: 'STRONG' as const, values: ['no' as const] },
  };
  await expect(db.savePreferences(memberId, key, 0, next)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  const results = await Promise.allSettled([
    db.savePreferences(memberId, randomUUID(), 1, next),
    db.savePreferences(memberId, randomUUID(), 1, next),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const history = await db.preferenceHistory(memberId);
  expect(history.map((r) => [r.version, r.priorVersion, r.source])).toEqual([
    [2, 1, 'USER'],
    [1, 0, 'USER'],
  ]);
  expect(history[1]?.data).toEqual(syntheticPreferences);
  await expect(
    app.query('UPDATE app.preference_versions SET body_cipher=$1 WHERE member_id=$2', [
      'overwritten',
      memberId,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
});
it('I-13 activate requires approved photos; stale transitions fail; deletion disables all authority immediately', async () => {
  const user = await readyAccount();
  let p = await db.policy(user.memberId);
  const key = randomUUID(),
    command = { action: 'ACTIVATE' as const, version: p.version };
  p = await db.changePolicy(user.auth, key, command);
  expect(p.state).toBe('ACTIVE');
  expect(await db.changePolicy(user.auth, key, command)).toEqual(p);
  await expect(db.changePolicy(user.auth, randomUUID(), command)).rejects.toThrow('STALE_VERSION');
  p = await db.changePolicy(user.auth, randomUUID(), { action: 'FOCUS', version: p.version });
  expect(p.intent).toBe('FOCUS');
  p = await db.changePolicy(user.auth, randomUUID(), {
    action: 'PAUSE',
    version: p.version,
    pauseChat: true,
  });
  expect(p.pauseChat).toBe(true);
  p = await db.changePolicy(user.auth, randomUUID(), { action: 'RESUME', version: p.version });
  expect(p).toMatchObject({ state: 'ACTIVE', intent: 'EXPLORE', nearby: 'GHOST' });
  await db.changePolicy(user.auth, randomUUID(), { action: 'DELETE', version: p.version });
  expect(await db.authority(user.token)).toBeNull();
  await expect(db.saveProfile(user.memberId, randomUUID(), 1, syntheticProfile)).rejects.toThrow(
    'ACCOUNT_DISABLED',
  );
});
it('I-19 and I-20 media owner/role checks, moderation CAS, immutable audited staff access', async () => {
  const owner = await account(),
    other = await account(),
    moderator = await account();
  const photo = await db.addPhoto(owner.memberId, randomUUID(), 'photo-fixture', async () => {});
  await expect(db.photoAccess(other.auth, photo.id, false, randomUUID())).rejects.toThrow(
    'NOT_FOUND',
  );
  await expect(db.photoAccess(other.auth, photo.id, true, randomUUID())).rejects.toThrow(
    'FORBIDDEN',
  );
  await admin.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'safety_reviewer')", [
    other.memberId,
  ]);
  await expect(db.moderationQueue(other.memberId, randomUUID())).rejects.toThrow('FORBIDDEN');
  await admin.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'operator')", [
    moderator.memberId,
  ]);
  await db.moderationQueue(moderator.memberId, randomUUID());
  await db.photoAccess(moderator.auth, photo.id, true, randomUUID());
  const result = await db.moderate(
    moderator.memberId,
    randomUUID(),
    photo.id,
    0,
    true,
    randomUUID(),
  );
  expect(result.status).toBe('APPROVED');
  await expect(
    db.moderate(moderator.memberId, randomUUID(), photo.id, 0, false, randomUUID()),
  ).rejects.toThrow('STALE_VERSION');
  await expect(db.auditLog(moderator.memberId, randomUUID())).rejects.toThrow('FORBIDDEN');
  const rows = await admin.query(
    'SELECT action FROM ops.audit WHERE actor_id=$1 ORDER BY created_at',
    [moderator.memberId],
  );
  expect(rows.rows.map((r) => r.action)).toEqual(['QUEUE_READ', 'MEDIA_READ', 'MEDIA_APPROVED']);
  await expect(ops.query("UPDATE ops.audit SET action='AUDIT_READ'")).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    app.query("UPDATE app.media SET status='APPROVED' WHERE id=$1", [photo.id]),
  ).rejects.toMatchObject({ code: '42501' });
  await admin.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'operator')", [
    owner.memberId,
  ]);
  const ownPhoto = await db.addPhoto(owner.memberId, randomUUID(), 'own-photo', async () => {});
  await expect(
    db.moderate(owner.memberId, randomUUID(), ownPhoto.id, 0, true, randomUUID()),
  ).rejects.toThrow('FORBIDDEN');
  await admin.query("UPDATE app.members SET state='RESTRICTED' WHERE id=$1", [moderator.memberId]);
  await expect(db.moderationQueue(moderator.memberId, randomUUID())).rejects.toThrow('FORBIDDEN');
});
it('REQ-027 duplicate uploads write once; concurrent uploads cannot exceed cap; removal revokes discovery', async () => {
  const user = await readyAccount();
  let writes = 0;
  const key = randomUUID();
  const write = async () => {
    writes++;
  };
  const raced = await Promise.allSettled([
    db.addPhoto(user.memberId, key, 'third-photo', write),
    db.addPhoto(user.memberId, key, 'third-photo', write),
  ]);
  expect(raced.every((result) => result.status === 'fulfilled')).toBe(true);
  const first = (raced[0] as PromiseFulfilledResult<{ id: string }>).value;
  expect(await db.addPhoto(user.memberId, key, 'third-photo', write)).toEqual(first);
  expect(writes).toBe(1);
  await expect(db.addPhoto(user.memberId, randomUUID(), 'fourth-photo', write)).rejects.toThrow(
    'PHOTO_LIMIT',
  );
  let p = await db.policy(user.memberId);
  p = await db.changePolicy(user.auth, randomUUID(), { action: 'ACTIVATE', version: p.version });
  expect(p.state).toBe('ACTIVE');
  await db.removePhoto(user.memberId, randomUUID(), (await db.photos(user.memberId))[0]!.id);
  expect((await db.policy(user.memberId)).state).toBe('ONBOARDING');
});
it('Session revocation is authoritative and sign out others preserves only the current session', async () => {
  const user = await account();
  const token2 = randomBytes(32).toString('base64url');
  await identity.query(
    "INSERT INTO identity.sessions(id,member_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [randomUUID(), user.memberId, hashToken(token2)],
  );
  expect(await db.authority(token2)).not.toBeNull();
  await db.revokeSessions(user.auth, true);
  expect(await db.authority(token2)).toBeNull();
  expect(await db.authority(user.token)).not.toBeNull();
  await db.revokeSessions(user.auth, false);
  expect(await db.authority(user.token)).toBeNull();
});
it('I-13 restriction cannot be bypassed through member transition commands', async () => {
  const user = await readyAccount();
  await admin.query("UPDATE app.members SET state='RESTRICTED' WHERE id=$1", [user.memberId]);
  const auth: Authority = user.auth;
  const p = await db.policy(user.memberId);
  await expect(
    db.changePolicy(auth, randomUUID(), { action: 'RESUME', version: p.version }),
  ).rejects.toThrow('ACCOUNT_DISABLED');
  await expect(
    db.savePreferences(user.memberId, randomUUID(), 1, syntheticPreferences),
  ).rejects.toThrow('ACCOUNT_DISABLED');
});
