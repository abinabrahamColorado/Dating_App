import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { migrate } from '../../packages/db/src/migrate';
import { AccountStore, type Authority } from '../../packages/db/src/accounts';
import { ExploreStore } from '../../packages/db/src/explore';
import { SafetyStore } from '../../packages/db/src/safety';
import { blockMember, memberProfile } from '../../packages/db/src/member-access';
import { hashToken } from '../../packages/db/src/encryption';
import { syntheticProfile, syntheticPreferences } from '../fixtures/accounts';
import { accountConfig } from '../../packages/config/src/accounts';
import { pilot } from '../../packages/config/src/pilot';
import { startWorker } from '../../apps/worker/src/worker';
import { registerExploreJobs } from '../../apps/worker/src/explore';
const source = process.env.TEST_DATABASE_URL;
if (!source || !new URL(source).pathname.endsWith('_test'))
  throw Error('Real isolated PostgreSQL required');
const name = `meetwell_explore_${randomUUID().replaceAll('-', '')}_test`;
const cluster = new Pool({ connectionString: source });
const url = new URL(source);
url.pathname = `/${name}`;
const admin = new Pool({ connectionString: url.toString() });
function role(name: string) {
  const u = new URL(url);
  u.searchParams.set('options', `-c role=meetwell_${name}`);
  return new Pool({ connectionString: u.toString(), application_name: `explore-test-${name}` });
}
const app = role('app'),
  identity = role('identity'),
  ops = role('ops'),
  safety = role('safety'),
  learning = role('learning');
const key = () => randomBytes(32).toString('base64');
const accounts = new AccountStore({
  app,
  identity,
  ops,
  identityKey: key(),
  appKey: key(),
  lookupKey: key(),
});
const db = new ExploreStore(accounts),
  safetyDb = new SafetyStore(accounts, safety, key());
beforeAll(async () => {
  if (!/^meetwell_explore_[a-f0-9]{32}_test$/.test(name)) throw Error('Invalid fixture database');
  await cluster.query(`CREATE DATABASE "${name}"`);
  await migrate(url.toString());
  await admin.query(
    "INSERT INTO app.explore_venues(id,name,public_centroid,approved,review_expires_at,synthetic) VALUES($1,'Synthetic test venue',ST_SetSRID(ST_Point(-74.001,40.746),4326)::geography,true,now()+interval '1 year',true)",
    [randomUUID()],
  );
});
beforeEach(async () => {
  await admin.query("UPDATE app.members SET state='PAUSED' WHERE state='ACTIVE'");
});
afterAll(async () => {
  await Promise.all([app, identity, ops, safety, learning, admin].map((p) => p.end()));
  await cluster.query(`DROP DATABASE IF EXISTS "${name}"`);
  await cluster.end();
});
async function member(staff = false): Promise<Authority> {
  const id = randomUUID(),
    sessionId = randomUUID();
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
    [sessionId, id, hashToken(randomUUID())],
  );
  await accounts.ensureMember(id);
  await accounts.register(id, {
    birthDate: '2002-01-15',
    termsVersion: accountConfig.TERMS_VERSION,
    privacyVersion: accountConfig.PRIVACY_VERSION,
    accepted: true,
  });
  await accounts.saveProfile(id, randomUUID(), 0, syntheticProfile);
  await accounts.savePreferences(id, randomUUID(), 0, syntheticPreferences);
  if (!staff)
    for (let i = 0; i < 2; i++)
      await admin.query("INSERT INTO app.media(id,member_id,status) VALUES($1,$2,'APPROVED')", [
        randomUUID(),
        id,
      ]);
  await admin.query("UPDATE app.members SET state='ACTIVE' WHERE id=$1", [id]);
  if (staff)
    await admin.query(
      "INSERT INTO ops.staff(member_id,role) VALUES($1,'operator'),($1,'safety_reviewer')",
      [id],
    );
  return { memberId: id, sessionId, authenticatedAt: new Date(), registered: true, age: 24 };
}
async function reservePair(a: Authority, b: Authority, staff: Authority) {
  const batch = await db.generate(
    staff,
    randomUUID(),
    { seed: randomUUID(), members: [a.memberId, b.memberId] },
    randomUUID(),
  );
  const review = await db.review(staff, batch.id, randomUUID());
  return { batch: batch.id, id: review.pairs[0]?.id };
}
async function delivered(a: Authority, b: Authority, staff: Authority) {
  const r = await reservePair(a, b, staff);
  if (!r.id) throw Error('Missing reservation');
  await db.edit(staff, r.batch, randomUUID(), { version: 0, action: 'APPROVE' }, randomUUID());
  expect(await db.deliverOne(r.id)).toEqual({ delivered: true });
  return { ...r, id: r.id };
}
async function counts(a: Authority, b: Authority) {
  return (
    await admin.query<{ member_id: string; held: number }>(
      'SELECT member_id,held FROM app.capacity_ledger WHERE member_id IN($1,$2) ORDER BY member_id',
      [a.memberId, b.memberId],
    )
  ).rows.map((r) => r.held);
}
async function grantCount(a: Authority, b: Authority) {
  return (
    await admin.query(
      'SELECT 1 FROM app.profile_access WHERE (viewer_id=$1 AND subject_id=$2) OR (viewer_id=$2 AND subject_id=$1)',
      [a.memberId, b.memberId],
    )
  ).rowCount;
}

it('I-02 I-06 I-15 scheduled allocation, approval and delivery persist conditional q and bilateral grants atomically', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  const batch = await db.generateScheduled();
  expect(await db.generateScheduled()).toEqual(batch);
  const review = await db.review(staff, batch.id, randomUUID());
  expect(review.pairs).toHaveLength(1);
  expect(await grantCount(a, b)).toBe(0);
  expect(await counts(a, b)).toEqual([1, 1]);
  await db.edit(staff, batch.id, randomUUID(), { version: 0, action: 'APPROVE' }, randomUUID());
  const id = review.pairs[0]!.id;
  expect(await db.deliverOne(id)).toEqual({ delivered: true });
  expect(await db.deliverOne(id)).toEqual({ delivered: false });
  expect(await grantCount(a, b)).toBe(2);
  expect(await counts(a, b)).toEqual([1, 1]);
  const exposure = (
    await learning.query('SELECT * FROM learning.introduction_exposure WHERE opportunity_id=$1', [
      id,
    ])
  ).rows[0];
  expect(exposure).toMatchObject({ policy: 'algorithm', q: 1, feasible_size: 1, step: 0 });
  expect(JSON.stringify(exposure)).not.toContain('chelsea');
  expect(JSON.stringify(exposure)).not.toContain(syntheticProfile.displayName);
  expect((await db.card(a, id)).profile.id).toBe(b.memberId);
  expect((await db.card(b, id)).profile.id).toBe(a.memberId);
  await expect(
    learning.query('UPDATE learning.introduction_exposure SET q=0 WHERE opportunity_id=$1', [id]),
  ).rejects.toMatchObject({ code: '42501' });
});
it('I-05 I-06 two racing batches reserve each pair once without exceeding either ledger', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  await Promise.all(
    [1, 2].map(() =>
      db.generate(
        staff,
        randomUUID(),
        { seed: randomUUID(), members: [a.memberId, b.memberId] },
        randomUUID(),
      ),
    ),
  );
  expect(
    (
      await admin.query(
        'SELECT 1 FROM app.opportunities WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)',
        [a.memberId, b.memberId],
      )
    ).rowCount,
  ).toBe(1);
  expect(await counts(a, b)).toEqual([1, 1]);
});
it('I-07 I-06 blind per-member versions permit mutual acceptance at capacity; close releases exactly once', async () => {
  const a = await member(),
    b = await member(),
    outsider = await member(),
    staff = await member(true);
  const { id } = await delivered(a, b, staff),
    before = await db.card(b, id),
    command = randomUUID();
  await admin.query('UPDATE app.capacity_ledger SET cap_limit=1 WHERE member_id IN($1,$2)', [
    a.memberId,
    b.memberId,
  ]);
  expect(await db.decide(a, id, command, { version: 0, decision: 'ACCEPT' })).toEqual({
    status: 'RESPONSE_SAVED',
  });
  expect(await db.card(b, id)).toEqual(before);
  expect(await db.decide(a, id, command, { version: 0, decision: 'ACCEPT' })).toEqual({
    status: 'RESPONSE_SAVED',
  });
  await expect(db.card(outsider, id)).rejects.toThrow('NOT_FOUND');
  expect(await db.decide(b, id, randomUUID(), { version: 0, decision: 'ACCEPT' })).toEqual({
    status: 'MUTUAL',
  });
  expect(await counts(a, b)).toEqual([1, 1]);
  expect((await admin.query('SELECT 1 FROM app.connections WHERE id=$1', [id])).rowCount).toBe(1);
  expect((await db.card(a, id)).status).toBe('MUTUAL');
  await db.close(a, id, randomUUID());
  await db.close(b, id, randomUUID());
  expect(await counts(a, b)).toEqual([0, 0]);
  expect(await grantCount(a, b)).toBe(0);
  expect((await reservePair(a, b, staff)).id).toBeUndefined();
});
it('I-05 I-08 pass and expiry are distinct, revoke grants and never reset exposure allowance', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  const { id } = await delivered(a, b, staff);
  await db.decide(a, id, randomUUID(), { version: 0, decision: 'PASS' });
  expect((await db.own(a)).opportunities[0]!.status).toBe('YOU_PASSED');
  expect((await db.own(b)).opportunities[0]!.status).toBe('UNAVAILABLE');
  expect(await grantCount(a, b)).toBe(0);
  expect(await counts(a, b)).toEqual([0, 0]);
  expect(
    (
      await admin.query('SELECT delivered,pending FROM app.exposure_week WHERE member_id=$1', [
        a.memberId,
      ])
    ).rows[0],
  ).toEqual({ delivered: 1, pending: 0 });
  const c = await member(),
    d = await member(),
    r = await delivered(c, d, staff);
  await admin.query(
    "UPDATE app.opportunities SET expires_at=now()-interval '1 second' WHERE id=$1",
    [r.id],
  );
  await Promise.all([
    db.expireOne(r.id),
    db.decide(c, r.id, randomUUID(), { version: 0, decision: 'ACCEPT' }),
  ]);
  expect((await db.own(c)).opportunities[0]!.status).toBe('EXPIRED');
  expect(await grantCount(c, d)).toBe(0);
  expect(await counts(c, d)).toEqual([0, 0]);
  expect(
    (
      await admin.query(
        "SELECT 1 FROM app.introduction_decisions WHERE opportunity_id=$1 AND decision='PASS'",
        [r.id],
      )
    ).rowCount,
  ).toBe(0);
});
it('I-04 restriction and profile revocation remove grants and pending capacity without exposing safety reasons', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  const { id } = await delivered(a, b, staff);
  await safetyDb.enforce(
    staff,
    randomUUID(),
    { subjectId: b.memberId, version: 0, restricted: true, caseId: null },
    randomUUID(),
  );
  expect(await grantCount(a, b)).toBe(0);
  expect(await counts(a, b)).toEqual([0, 0]);
  await expect(memberProfile(accounts, a, b.memberId)).rejects.toThrow('NOT_FOUND');
  expect((await db.own(a)).opportunities[0]!.status).toBe('UNAVAILABLE');
  expect(
    (
      await safetyDb.report(
        b,
        randomUUID(),
        { subjectId: a.memberId, context: { surface: 'card', referenceId: id } },
        randomUUID(),
      )
    ).status,
  ).toBe('RECEIVED');
  const c = await member(),
    d = await member();
  await delivered(c, d, staff);
  await accounts.savePreferences(c.memberId, randomUUID(), 1, syntheticPreferences);
  expect(await grantCount(c, d)).toBe(0);
  expect(await counts(c, d)).toEqual([0, 0]);
});
it('I-15 operator-scoped and edited batches log unknown propensity and require current staff authority', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  const r = await delivered(a, b, staff);
  expect(
    (
      await learning.query(
        'SELECT policy,q FROM learning.introduction_exposure WHERE opportunity_id=$1',
        [r.id],
      )
    ).rows[0],
  ).toEqual({ policy: 'operator', q: null });
  await admin.query('DELETE FROM ops.staff WHERE member_id=$1', [staff.memberId]);
  await expect(db.review(staff, r.batch, randomUUID())).rejects.toThrow('FORBIDDEN');
});
it('I-04 I-15 notification retries distinguish definitely-unsent from uncertain delivery and never send after block', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  const { id } = await delivered(a, b, staff);
  const mail = (
    await admin.query<{ id: string }>(
      'SELECT id FROM app.introduction_mail WHERE opportunity_id=$1 ORDER BY id',
      [id],
    )
  ).rows;
  let calls = 0;
  await db.sendOne(mail[0]!.id, async () => {
    calls++;
    return 'RETRY';
  });
  await admin.query('UPDATE app.introduction_mail SET next_attempt_at=now() WHERE id=$1', [
    mail[0]!.id,
  ]);
  await db.sendOne(mail[0]!.id, async () => {
    calls++;
    return 'UNCERTAIN';
  });
  await db.sendOne(mail[0]!.id, async () => {
    calls++;
    return 'SENT';
  });
  expect(calls).toBe(2);
  await blockMember(accounts, a, b.memberId, randomUUID());
  await db.sendOne(mail[1]!.id, async () => {
    calls++;
    return 'SENT';
  });
  expect(calls).toBe(2);
  expect(await grantCount(a, b)).toBe(0);
  expect(await counts(a, b)).toEqual([0, 0]);
});
it('I-04 block during reservation, delivery and acceptance wins before the waiting transition reads authority', async () => {
  const staff = await member(true);
  for (const stage of ['reservation', 'delivery', 'acceptance']) {
    const a = await member(),
      b = await member();
    let id: string | undefined;
    if (stage !== 'reservation') {
      const r = await reservePair(a, b, staff);
      id = r.id!;
      await db.edit(staff, r.batch, randomUUID(), { version: 0, action: 'APPROVE' }, randomUUID());
      if (stage === 'acceptance') await db.deliverOne(id);
    }
    const barrier = await admin.connect();
    await barrier.query('BEGIN');
    await barrier.query('SELECT app.lock_pair($1,$2)', [a.memberId, b.memberId]);
    const waiting =
      stage === 'reservation'
        ? reservePair(a, b, staff)
        : stage === 'delivery'
          ? db.deliverOne(id!)
          : db.decide(a, id!, randomUUID(), { version: 0, decision: 'ACCEPT' });
    await expect
      .poll(
        async () =>
          (
            await admin.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='explore-test-app' AND wait_event_type='Lock'",
            )
          ).rowCount,
      )
      .toBeGreaterThan(0);
    // This is the same directional insert under the same pair lock as blockMember;
    // the external transaction deterministically places it before the waiting gate.
    await barrier.query(
      'INSERT INTO app.blocks(low_id,high_id,blocker_id) VALUES(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),$1)',
      [a.memberId, b.memberId],
    );
    await barrier.query('COMMIT');
    barrier.release();
    await waiting;
    expect(await grantCount(a, b)).toBe(0);
    expect((await counts(a, b)).every((n) => n === 0)).toBe(true);
    if (id)
      expect(
        (await admin.query('SELECT state FROM app.opportunities WHERE id=$1', [id])).rows[0].state,
      ).toBe('BLOCKED');
  }
});

it('I-04 block during an already locked reservation, delivery or acceptance waits, then revokes every resulting grant and slot', async () => {
  const staff = await member(true);
  for (const stage of ['reservation', 'delivery', 'acceptance']) {
    const a = await member(),
      b = await member();
    let id: string | undefined;
    if (stage === 'reservation') {
      await db.own(a);
      await db.own(b);
    } else {
      const r = await reservePair(a, b, staff);
      id = r.id!;
      await db.edit(staff, r.batch, randomUUID(), { action: 'APPROVE', version: 0 }, randomUUID());
      if (stage === 'acceptance') await db.deliverOne(id);
    }
    const barrier = await admin.connect();
    await barrier.query('BEGIN');
    if (stage === 'reservation')
      await barrier.query(
        'SELECT member_id FROM app.capacity_ledger WHERE member_id IN($1,$2) ORDER BY member_id FOR UPDATE',
        [a.memberId, b.memberId],
      );
    else await barrier.query('SELECT id FROM app.opportunities WHERE id=$1 FOR UPDATE', [id]);
    const transition =
      stage === 'reservation'
        ? db.generate(
            staff,
            randomUUID(),
            { seed: randomUUID(), members: [a.memberId, b.memberId] },
            randomUUID(),
          )
        : stage === 'delivery'
          ? db.deliverOne(id!)
          : db.decide(a, id!, randomUUID(), { decision: 'ACCEPT', version: 0 });
    try {
      await expect
        .poll(
          async () =>
            (
              await admin.query(
                "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='explore-test-app' AND wait_event_type='Lock'",
              )
            ).rowCount,
        )
        .toBeGreaterThan(0);
      const blocking = blockMember(accounts, b, a.memberId, randomUUID());
      await expect
        .poll(
          async () =>
            (
              await admin.query(
                "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='explore-test-app' AND wait_event_type='Lock'",
              )
            ).rowCount,
        )
        .toBeGreaterThan(1);
      await barrier.query('COMMIT');
      await transition;
      await blocking;
    } finally {
      await barrier.query('ROLLBACK');
      barrier.release();
    }
    expect(await counts(a, b)).toEqual([0, 0]);
    expect(await grantCount(a, b)).toBe(0);
    expect(
      (
        await admin.query(
          'SELECT state FROM app.opportunities WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)',
          [a.memberId, b.memberId],
        )
      ).rows[0].state,
    ).toBe('BLOCKED');
  }
});
it('I-05 I-06 weekly delivery allowance survives passes and concierge edits use the same limits', async () => {
  const a = await member(),
    staff = await member(true);
  for (let i = 0; i < pilot.MAX_NEW_INTROS_PER_WEEK; i++) {
    const b = await member(),
      r = await delivered(a, b, staff);
    await db.decide(a, r.id, randomUUID(), { decision: 'PASS', version: 0 });
    expect(await counts(a, b)).toEqual([0, 0]);
  }
  const b = await member(),
    batch = await db.generate(
      staff,
      randomUUID(),
      { seed: 'weekly-cap', members: [a.memberId, b.memberId] },
      randomUUID(),
    );
  expect((await db.review(staff, batch.id, randomUUID())).pairs).toHaveLength(0);
  await expect(
    db.edit(
      staff,
      batch.id,
      randomUUID(),
      { action: 'ADD', version: 0, u: a.memberId, v: b.memberId },
      randomUUID(),
    ),
  ).rejects.toThrow('PAIR_INELIGIBLE');
  const c = await member(),
    d = await member();
  await db.edit(
    staff,
    batch.id,
    randomUUID(),
    { action: 'ADD', version: 0, u: c.memberId, v: d.memberId },
    randomUUID(),
  );
  const review = await db.review(staff, batch.id, randomUUID());
  expect(review.policy).toBe('operator');
  await db.edit(
    staff,
    batch.id,
    randomUUID(),
    { action: 'REMOVE', version: 1, opportunityId: review.pairs[0]!.id },
    randomUUID(),
  );
  expect(await counts(c, d)).toEqual([0, 0]);
  await expect(
    db.edit(
      staff,
      batch.id,
      randomUUID(),
      { action: 'ADD', version: 2, u: c.memberId, v: d.memberId },
      randomUUID(),
    ),
  ).rejects.toThrow('PAIR_INELIGIBLE');
});
it('I-04 I-15 real pg-boss batch, delivery, notification and expiry jobs enforce policy and reminder opt-in', async () => {
  const a = await member(),
    b = await member(),
    staff = await member(true);
  await admin.query(
    'UPDATE app.explore_batches SET scheduled_week=NULL WHERE scheduled_week IS NOT NULL',
  );
  const workerUrl = new URL(url);
  workerUrl.searchParams.set('options', '-c role=meetwell_worker');
  const boss = await startWorker(workerUrl.toString());
  let sent = 0;
  async function run(name: string) {
    const id = await boss.send(name, {});
    await expect
      .poll(
        async () =>
          (await admin.query('SELECT state FROM queue.job WHERE id=$1', [id])).rows[0]?.state,
        { timeout: 20000 },
      )
      .toBe('completed');
  }
  try {
    await registerExploreJobs(boss, db, async () => {
      sent++;
      return 'SENT';
    });
    await run('explore.batch');
    const batch = (
      await admin.query('SELECT id FROM app.explore_batches WHERE scheduled_week IS NOT NULL')
    ).rows[0].id;
    const review = await db.review(staff, batch, randomUUID());
    expect(review.pairs).toHaveLength(1);
    await db.edit(staff, batch, randomUUID(), { action: 'APPROVE', version: 0 }, randomUUID());
    await run('explore.deliver');
    expect(await grantCount(a, b)).toBe(2);
    await run('explore.mail');
    expect(sent).toBe(2);
    const id = review.pairs[0]!.id;
    await admin.query(
      "UPDATE app.opportunities SET expires_at=now()+interval '1 hour' WHERE id=$1",
      [id],
    );
    await run('explore.maintain');
    expect(
      (
        await admin.query(
          "SELECT 1 FROM app.introduction_mail WHERE opportunity_id=$1 AND kind='REMINDER'",
          [id],
        )
      ).rowCount,
    ).toBe(0);
    const own = await db.own(a);
    await db.capacity(a, randomUUID(), {
      version: own.capacity.version,
      limit: 1,
      reminders: true,
    });
    await run('explore.maintain');
    expect(
      (
        await admin.query(
          "SELECT member_id FROM app.introduction_mail WHERE opportunity_id=$1 AND kind='REMINDER'",
          [id],
        )
      ).rows,
    ).toEqual([{ member_id: a.memberId }]);
    await blockMember(accounts, a, b.memberId, randomUUID());
    await run('explore.mail');
    expect(sent).toBe(2);
    expect(await grantCount(a, b)).toBe(0);
  } finally {
    await boss.stop({ graceful: true });
  }
}, 60000);
