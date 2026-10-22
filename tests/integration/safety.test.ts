import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AccountStore, type Authority } from '../../packages/db/src/accounts';
import { SafetyStore } from '../../packages/db/src/safety';
import { memberProfile, blockMember, withMemberPair } from '../../packages/db/src/member-access';
import { hashToken } from '../../packages/db/src/encryption';
import { migrate } from '../../packages/db/src/migrate';
import { syntheticProfile } from '../fixtures/accounts';
import { accountConfig } from '../../packages/config/src/accounts';
import { requireSupportedClient } from '../../packages/db/src/client-policy';
import { safetyConfig } from '../../packages/config/src/safety';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Isolated real PostgreSQL required');
const admin = new Pool({ connectionString: url });
function role(name: string) {
  const u = new URL(url!);
  u.searchParams.set('options', `-c role=meetwell_${name}`);
  return new Pool({ connectionString: u.toString() });
}
const identity = role('identity'),
  app = role('app'),
  ops = role('ops'),
  safety = role('safety'),
  learning = role('learning');
const key = () => randomBytes(32).toString('base64');
const accounts = new AccountStore({
  identity,
  app,
  ops,
  identityKey: key(),
  appKey: key(),
  lookupKey: key(),
});
const db = new SafetyStore(accounts, safety, key());
const created: string[] = [];
beforeAll(async () => {
  await migrate(url);
});
afterAll(async () => {
  // Keep isolated, randomly encrypted fixtures out of the browser's operational queues.
  await admin.query("UPDATE safety.report SET status='CLOSED' WHERE reporter_id=ANY($1::uuid[])", [
    created,
  ]);
  await admin.query(
    "UPDATE safety.integrity_signal SET status='CLOSED' WHERE reporter_id=ANY($1::uuid[])",
    [created],
  );
  await admin.query(
    "UPDATE safety.appeal SET status='UPHELD' WHERE member_id=ANY($1::uuid[]) AND status='OPEN'",
    [created],
  );
  await Promise.all([admin, identity, app, ops, safety, learning].map((p) => p.end()));
});
async function member(staff = false): Promise<Authority> {
  const id = randomUUID(),
    session = randomUUID();
  created.push(id);
  await identity.query(
    'INSERT INTO identity.users(id,email_lookup,email_cipher) VALUES($1,$2,$3)',
    [
      id,
      accounts.lookup(`${id}@synthetic.invalid`),
      accounts.identityCipher.seal(`${id}@synthetic.invalid`, `email:${id}`),
    ],
  );
  await identity.query(
    "INSERT INTO identity.sessions(id,member_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [session, id, hashToken(randomUUID())],
  );
  await accounts.ensureMember(id);
  await accounts.register(id, {
    birthDate: '2002-01-15',
    termsVersion: accountConfig.TERMS_VERSION,
    privacyVersion: accountConfig.PRIVACY_VERSION,
    accepted: true,
  });
  await accounts.saveProfile(id, randomUUID(), 0, syntheticProfile);
  await admin.query("UPDATE app.members SET state='ACTIVE' WHERE id=$1", [id]);
  if (staff)
    await admin.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'safety_reviewer')", [id]);
  return {
    memberId: id,
    sessionId: session,
    authenticatedAt: new Date(),
    registered: true,
    age: 24,
  };
}
const input = (subjectId: string | null, detail = '') => ({
  subjectId,
  detail,
  severity: 'STANDARD',
  context: { surface: 'settings' },
});
async function access(a: Authority, b: Authority) {
  await admin.query(
    "INSERT INTO app.profile_access(viewer_id,subject_id,expires_at) VALUES($1,$2,now()+interval '1 day'),($2,$1,now()+interval '1 day')",
    [a.memberId, b.memberId],
  );
}
it('I-04 authoritative bilateral block denies both profile directions and stale sessions immediately without notifying', async () => {
  const a = await member(),
    b = await member();
  await access(a, b);
  expect((await memberProfile(accounts, a, b.memberId)).displayName).toBe(
    syntheticProfile.displayName,
  );
  expect((await memberProfile(accounts, b, a.memberId)).age).toBeGreaterThanOrEqual(18);
  const command = randomUUID();
  await blockMember(accounts, a, b.memberId, command);
  await blockMember(accounts, a, b.memberId, command);
  await expect(memberProfile(accounts, a, b.memberId)).rejects.toThrow('NOT_FOUND');
  await expect(memberProfile(accounts, b, a.memberId)).rejects.toThrow('NOT_FOUND');
  expect(await db.ownCases(b, randomUUID())).toEqual([]);
  expect(
    (await admin.query('SELECT 1 FROM safety.report WHERE reporter_id=$1', [a.memberId])).rowCount,
  ).toBe(0);
  expect(
    (
      await admin.query(
        'SELECT 1 FROM app.blocks WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)',
        [a.memberId, b.memberId],
      )
    ).rowCount,
  ).toBe(1);
});
it('I-04 directional rows retain the blocker; neither the subject nor runtime can remove another block', async () => {
  const a = await member(),
    b = await member();
  await access(a, b);
  await blockMember(accounts, a, b.memberId, randomUUID());
  expect(
    (await admin.query('SELECT blocker_id FROM app.blocks WHERE blocker_id=$1', [a.memberId])).rows,
  ).toEqual([{ blocker_id: a.memberId }]);
  await blockMember(accounts, b, a.memberId, randomUUID());
  expect(
    (
      await admin.query(
        'SELECT blocker_id FROM app.blocks WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)',
        [a.memberId, b.memberId],
      )
    ).rows
      .map((r) => r.blocker_id)
      .sort(),
  ).toEqual([a.memberId, b.memberId].sort());
  await expect(
    app.query('DELETE FROM app.blocks WHERE blocker_id=$1', [a.memberId]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    app.query('UPDATE app.blocks SET blocker_id=$1 WHERE blocker_id=$2', [b.memberId, a.memberId]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    admin.query(
      'INSERT INTO app.blocks(low_id,high_id,blocker_id) VALUES(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),$3)',
      [a.memberId, b.memberId, randomUUID()],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(memberProfile(accounts, a, b.memberId)).rejects.toThrow('NOT_FOUND');
  await expect(memberProfile(accounts, b, a.memberId)).rejects.toThrow('NOT_FOUND');
  const c = await member(),
    d = await member();
  await access(c, d);
  await admin.query(
    'INSERT INTO app.legacy_pair_denials VALUES(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),now())',
    [c.memberId, d.memberId],
  );
  await expect(memberProfile(accounts, c, d.memberId)).rejects.toThrow('NOT_FOUND');
  await expect(memberProfile(accounts, d, c.memberId)).rejects.toThrow('NOT_FOUND');
});
it('I-11 P20 client shutdown refuses activity but preserves reporting and assistance', async () => {
  const staff = await member(true),
    reporter = await member(),
    version = `test-${randomUUID()}`;
  await db.switch(
    staff,
    randomUUID(),
    { scope: 'CLIENT_VERSION', target: version, disabled: true, version: 0 },
    randomUUID(),
  );
  await expect(requireSupportedClient(accounts, 'members/subject', 'GET', version)).rejects.toThrow(
    'CLIENT_VERSION_DISABLED',
  );
  await expect(
    requireSupportedClient(accounts, 'account/sessions', 'GET', version),
  ).rejects.toThrow('CLIENT_VERSION_DISABLED');
  await expect(
    requireSupportedClient(accounts, 'members/subject', 'GET', safetyConfig.CLIENT_VERSION),
  ).resolves.toBeUndefined();
  for (const route of ['safety/reports', 'safety/block', 'safety/appeal', 'auth/request'])
    await expect(requireSupportedClient(accounts, route, 'POST', version)).resolves.toBeUndefined();
  expect(await db.report(reporter, randomUUID(), input(null), randomUUID())).toMatchObject({
    status: 'RECEIVED',
  });
  await db.switch(
    staff,
    randomUUID(),
    { scope: 'CLIENT_VERSION', target: version, disabled: false, version: 1 },
    randomUUID(),
  );
  await expect(
    requireSupportedClient(accounts, 'account/sessions', 'GET', version),
  ).resolves.toBeUndefined();
});
it('I-11 report, block, acknowledgement and case status are independent, object authorized and idempotent', async () => {
  const a = await member(),
    b = await member();
  await access(a, b);
  const k = randomUUID(),
    payload = input(b.memberId);
  const result = await db.report(a, k, payload, randomUUID());
  expect(await db.report(a, k, payload, randomUUID())).toEqual(result);
  expect((await memberProfile(accounts, a, b.memberId)).id).toBe(b.memberId);
  expect(await db.ownCase(a, result.id, randomUUID())).toMatchObject({ status: 'RECEIVED' });
  await expect(db.ownCase(b, result.id, randomUUID())).rejects.toThrow('NOT_FOUND');
  expect(JSON.stringify(await db.ownEnforcement(b))).not.toContain(a.memberId);
  await expect(db.report(a, k, input(b.memberId, 'changed'), randomUUID())).rejects.toThrow(
    'IDEMPOTENCY_CONFLICT',
  );
  await blockMember(accounts, a, b.memberId, randomUUID());
  expect(await db.ownCases(a, randomUUID())).toHaveLength(1);
  expect(await db.report(a, randomUUID(), input(b.memberId), randomUUID())).toMatchObject({
    status: 'RECEIVED',
  });
});
it('I-11 reporting survives physical deletion of the subject and account restrictions and every kill switch', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  await admin.query('DELETE FROM app.profiles WHERE member_id=$1', [b.memberId]);
  await admin.query('DELETE FROM app.command_receipts WHERE member_id=$1', [b.memberId]);
  await admin.query('DELETE FROM app.members WHERE id=$1', [b.memberId]);
  expect(await db.report(a, randomUUID(), input(b.memberId), randomUUID())).toMatchObject({
    status: 'RECEIVED',
  });
  await db.enforce(
    staff,
    randomUUID(),
    { subjectId: a.memberId, version: 0, restricted: true, caseId: null },
    randomUUID(),
  );
  for (const scope of ['ALL_GO', 'NEW_PERSON_GO', 'VENUE', 'EVENT'])
    await db.switch(
      staff,
      randomUUID(),
      {
        scope,
        target: ['VENUE', 'EVENT'].includes(scope) ? randomUUID() : null,
        version:
          (await db.switches(staff, randomUUID())).overrides.find(
            (r) => r.scope === scope && r.target === 'GLOBAL',
          )?.version ?? 0,
        disabled: true,
      },
      randomUUID(),
    );
  expect(await db.report(a, randomUUID(), input(b.memberId), randomUUID())).toMatchObject({
    status: 'RECEIVED',
  });
  expect(await blockMember(accounts, a, b.memberId, randomUUID())).toEqual({ blocked: true });
});
it('I-12 PostgreSQL denies report text and all safety tables to app, learning, ops and identity roles; narratives stay encrypted', async () => {
  const a = await member(),
    detail = `synthetic-secret-${randomUUID()}`;
  const r = await db.report(a, randomUUID(), input(null, detail), randomUUID());
  for (const pool of [app, learning, ops, identity]) {
    for (const table of [
      'report',
      'safety_signal',
      'enforcement',
      'appeal',
      'case_access_audit',
      'integrity_signal',
      'command_receipts',
    ])
      await expect(pool.query(`SELECT * FROM safety.${table}`)).rejects.toMatchObject({
        code: '42501',
      });
    await expect(
      pool.query('SELECT detail_cipher FROM safety.report WHERE id=$1', [r.id]),
    ).rejects.toMatchObject({ code: '42501' });
  }
  const raw = (await safety.query('SELECT * FROM safety.report WHERE id=$1', [r.id])).rows[0];
  expect(JSON.stringify(raw)).not.toContain(detail);
  expect(
    (await app.query('SELECT app.enforcement_status($1) AS denied', [a.memberId])).rows[0],
  ).toEqual({ denied: false });
  const staff = await member(true);
  expect((await db.view(staff, r.id, 'report', randomUUID())).detail).toBe(detail);
  expect(JSON.stringify(await db.auditLog(staff, randomUUID(), 0))).not.toContain(detail);
  const i = await db.report(
    a,
    randomUUID(),
    { subjectId: null, detail, context: { surface: 'settings' } },
    randomUUID(),
    true,
  );
  expect((await safety.query('SELECT 1 FROM safety.report WHERE id=$1', [i.id])).rowCount).toBe(0);
  expect((await db.view(staff, i.id, 'integrity', randomUUID())).detail).toBe(detail);
});
it('I-20 every case view is append-only audited and a role revoked after session creation cannot read a case', async () => {
  const a = await member(),
    staff = await member(true),
    ordinary = await member();
  const r = await db.report(a, randomUUID(), input(null), randomUUID());
  const before = Number(
    (await safety.query('SELECT count(*) FROM safety.case_access_audit WHERE record_id=$1', [r.id]))
      .rows[0].count,
  );
  await db.view(staff, r.id, 'report', randomUUID());
  await db.view(staff, r.id, 'report', randomUUID());
  expect(
    Number(
      (
        await safety.query('SELECT count(*) FROM safety.case_access_audit WHERE record_id=$1', [
          r.id,
        ])
      ).rows[0].count,
    ),
  ).toBe(before + 2);
  await expect(
    safety.query('DELETE FROM safety.case_access_audit WHERE record_id=$1', [r.id]),
  ).rejects.toMatchObject({ code: '42501' });
  await admin.query('DELETE FROM ops.staff WHERE member_id=$1', [staff.memberId]);
  await expect(db.view(staff, r.id, 'report', randomUUID())).rejects.toThrow('FORBIDDEN');
  await expect(db.queue(staff, 'report', randomUUID(), 0)).rejects.toThrow('FORBIDDEN');
  await admin.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'admin')", [
    ordinary.memberId,
  ]);
  await expect(db.view(ordinary, r.id, 'report', randomUUID())).rejects.toThrow('FORBIDDEN');
});
it('I-19 I-20 session revocation rejects old Authority at the operation boundary, including case reads and M1 writes', async () => {
  const staff = await member(true),
    a = await member();
  const r = await db.report(a, randomUUID(), input(null), randomUUID());
  await identity.query('UPDATE identity.sessions SET revoked_at=now() WHERE id=$1', [
    staff.sessionId,
  ]);
  await expect(db.view(staff, r.id, 'report', randomUUID())).rejects.toThrow('UNAUTHORIZED');
  await expect(
    accounts.withSession(staff, () =>
      accounts.saveProfile(staff.memberId, randomUUID(), 1, syntheticProfile),
    ),
  ).rejects.toThrow('UNAUTHORIZED');
  await expect(accounts.revokeSessions(staff, true)).rejects.toThrow('UNAUTHORIZED');
});
it('I-04 I-20 precaution/lift and appeal are versioned, independent of account exit, and never driven by report count', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  await access(a, b);
  const r = await db.report(a, randomUUID(), input(b.memberId), randomUUID());
  for (let n = 0; n < 3; n++) await db.report(a, randomUUID(), input(b.memberId), randomUUID());
  expect((await db.ownEnforcement(b)).restricted).toBe(false);
  const k = randomUUID(),
    command = { subjectId: b.memberId, caseId: r.id, version: 0, restricted: true };
  await db.enforce(staff, k, command, randomUUID());
  expect(await db.enforce(staff, k, command, randomUUID())).toEqual({
    restricted: true,
    version: 1,
  });
  await expect(memberProfile(accounts, a, b.memberId)).rejects.toThrow('NOT_FOUND');
  expect(JSON.stringify(await db.ownEnforcement(b))).not.toContain(r.id);
  const appeal = await db.appeal(
    b,
    randomUUID(),
    { version: 1, detail: 'Synthetic appeal' },
    randomUUID(),
  );
  await expect(
    db.decideAppeal(
      staff,
      appeal.id,
      randomUUID(),
      { version: 0, decision: 'LIFTED' },
      randomUUID(),
    ),
  ).rejects.toThrow('INDEPENDENT_REVIEW_REQUIRED');
  const independent = await member(true);
  await db.decideAppeal(
    independent,
    appeal.id,
    randomUUID(),
    { version: 0, decision: 'LIFTED' },
    randomUUID(),
  );
  expect((await memberProfile(accounts, a, b.memberId)).id).toBe(b.memberId);
  await db.enforce(staff, randomUUID(), { ...command, version: 2 }, randomUUID());
  await accounts.withSession(b, () =>
    accounts.changePolicy(b, randomUUID(), { action: 'EXIT', version: 1 }),
  );
  expect((await db.ownEnforcement(b)).restricted).toBe(true);
  expect(await db.appeal(b, randomUUID(), { version: 3 }, randomUUID())).toMatchObject({
    received: true,
  });
});
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it('I-20 race: staff revocation waits for the protected read and denies the next case view', async () => {
  const a = await member(),
    staff = await member(true),
    r = await db.report(a, randomUUID(), input(null), randomUUID());
  const entered = latch(),
    release = latch();
  const read = accounts.withSession(staff, () =>
    accounts.withStaff(staff.memberId, ['safety_reviewer'], async () => {
      const result = await db.view(staff, r.id, 'report', randomUUID());
      entered.resolve();
      await release.promise;
      return result;
    }),
  );
  await entered.promise;
  const revoke = admin.query('DELETE FROM ops.staff WHERE member_id=$1', [staff.memberId]);
  try {
    await expect
      .poll(async () =>
        Number(
          (
            await admin.query(
              "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'DELETE FROM ops.staff%' AND pid<>pg_backend_pid()",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
  } finally {
    release.resolve();
  }
  await read;
  await revoke;
  await expect(db.view(staff, r.id, 'report', randomUUID())).rejects.toThrow('FORBIDDEN');
});
it('I-19 I-20 race: session revocation interlocks with active access and fails closed on later requests', async () => {
  const staff = await member(true),
    entered = latch(),
    release = latch();
  const read = accounts.withSession(staff, async () => {
    entered.resolve();
    await release.promise;
    return true;
  });
  await entered.promise;
  const revoke = admin.query('UPDATE identity.sessions SET revoked_at=now() WHERE id=$1', [
    staff.sessionId,
  ]);
  try {
    await expect
      .poll(async () =>
        Number(
          (
            await admin.query(
              "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE identity.sessions SET revoked_at%' AND pid<>pg_backend_pid()",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
  } finally {
    release.resolve();
  }
  await read;
  await revoke;
  await expect(db.queue(staff, 'report', randomUUID(), 0)).rejects.toThrow('UNAUTHORIZED');
});
it('I-04 I-19 ungranted objects and an unavailable authorization store never grant profile or case access', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  await expect(memberProfile(accounts, a, b.memberId)).rejects.toThrow('NOT_FOUND');
  const closedPool = role('safety');
  await closedPool.end();
  const unavailable = new SafetyStore(accounts, closedPool, key());
  await expect(unavailable.queue(staff, 'report', randomUUID(), 0)).rejects.toThrow();
});
it('I-04 race: a profile read already holding pair locks completes before block acknowledgement; subsequent reads fail', async () => {
  const a = await member(),
    b = await member();
  await access(a, b);
  const entered = latch(),
    release = latch();
  const read = withMemberPair(accounts, a, b.memberId, async () => {
    entered.resolve();
    await release.promise;
    return 'authorized';
  });
  await entered.promise;
  let done = false;
  const block = blockMember(accounts, b, a.memberId, randomUUID()).then((r) => {
    done = true;
    return r;
  });
  try {
    await expect
      .poll(async () =>
        Number(
          (
            await admin.query(
              "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT app.lock_pair%' AND pid<>pg_backend_pid()",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
    expect(done).toBe(false);
  } finally {
    release.resolve();
  }
  expect(await read).toBe('authorized');
  await block;
  await expect(memberProfile(accounts, a, b.memberId)).rejects.toThrow('NOT_FOUND');
});
it('I-04 race: a committed block wins against a queued profile read on another session', async () => {
  const a = await member(),
    b = await member();
  await access(a, b);
  const hold = await admin.connect();
  await hold.query('BEGIN');
  await hold.query('SELECT app.lock_pair($1,$2)', [a.memberId, b.memberId]);
  const block = blockMember(accounts, b, a.memberId, randomUUID());
  let read: Promise<unknown> | undefined;
  try {
    await expect
      .poll(async () =>
        Number(
          (
            await admin.query(
              "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT app.lock_pair%' AND pid<>pg_backend_pid()",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
    read = memberProfile(accounts, a, b.memberId).then(
      () => 'leaked',
      (e: Error) => e.message,
    );
  } finally {
    await hold.query('COMMIT');
    hold.release();
  }
  await block;
  expect(await read).toBe('NOT_FOUND');
});
it('I-04 I-11 race: block and report filed at the same moment both commit independently', async () => {
  const a = await member(),
    b = await member();
  await access(a, b);
  const [blocked, report] = await Promise.all([
    blockMember(accounts, a, b.memberId, randomUUID()),
    db.report(b, randomUUID(), input(a.memberId), randomUUID()),
  ]);
  expect(blocked).toEqual({ blocked: true });
  expect(report.status).toBe('RECEIVED');
  expect((await db.ownCase(b, report.id, randomUUID())).status).toBe('RECEIVED');
  await expect(memberProfile(accounts, b, a.memberId)).rejects.toThrow('NOT_FOUND');
});
