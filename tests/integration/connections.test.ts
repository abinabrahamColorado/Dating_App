import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connectionFixture } from '../fixtures/connections-db';
import { blockMember, memberProfile } from '../../packages/db/src/member-access';
import { syntheticProfile } from '../fixtures/accounts';
import { syntheticVenue } from '../fixtures/venues';
import { defaultPlanningPreferences } from '../../packages/core/src/connections';
import { startWorker } from '../../apps/worker/src/worker';
import { registerConnectionJobs } from '../../apps/worker/src/connections';
const f = connectionFixture(),
  db = f.connections;
beforeAll(f.start);
afterAll(f.stop);
beforeEach(async () => {
  await f.admin.query("UPDATE app.members SET state='PAUSED' WHERE state='ACTIVE'");
  await f.admin.query('UPDATE app.explore_venues SET approved=false WHERE approved');
});
async function open(a: Parameters<typeof db.view>[0], id: string) {
  const view = await db.view(a, id);
  expect(view.status).toBe('OPEN');
  if (view.status !== 'OPEN') throw Error('Expected open');
  return view;
}
async function waiting(n = 1) {
  await expect
    .poll(
      async () =>
        (
          await f.admin.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='connections-test-app' AND wait_event_type='Lock'",
          )
        ).rowCount,
    )
    .toBeGreaterThanOrEqual(n);
}
it('I-04 I-12 I-19 encrypted chat is private, delivery is durable and object authorization includes revoked sessions', async () => {
  const p = await f.pair(),
    stranger = await f.member(),
    key = randomUUID(),
    text = 'Synthetic private chat test';
  const message = await db.send(p.a, p.id, key, { text });
  expect(await db.send(p.a, p.id, key, { text })).toEqual(message);
  expect((await open(p.b, p.id)).messages).toHaveLength(0);
  expect(
    (await f.app.query('SELECT body_cipher FROM app.messages WHERE id=$1', [message.id])).rows[0]
      .body_cipher,
  ).not.toContain(text);
  await expect(f.learning.query('SELECT body_cipher FROM app.messages')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(db.view(stranger, p.id)).rejects.toThrow('NOT_FOUND');
  await expect(db.send(stranger, p.id, randomUUID(), { text })).rejects.toThrow('NOT_FOUND');
  expect(await db.deliverOne(message.id)).toBe(true);
  expect(await db.deliverOne(message.id)).toBe(false);
  expect((await open(p.b, p.id)).messages[0]).toMatchObject({ text, own: false });
  await f.identity.query('UPDATE identity.sessions SET revoked_at=now() WHERE id=$1', [
    p.a.sessionId,
  ]);
  await expect(db.send(p.a, p.id, randomUUID(), { text })).rejects.toThrow('UNAUTHORIZED');
});
it('I-04 I-06 I-08 I-13 pause respects the explicit keep-chat choice, Focus keeps existing connections, closure releases capacity once', async () => {
  const p = await f.pair();
  await f.accounts.changePolicy(p.a, randomUUID(), {
    action: 'PAUSE',
    version: (await f.accounts.policy(p.a.memberId)).version,
    pauseChat: true,
  });
  await db.send(p.a, p.id, randomUUID(), { text: 'Synthetic retained chat' });
  expect((await memberProfile(f.accounts, p.b, p.a.memberId)).id).toBe(p.a.memberId);
  await f.admin.query('UPDATE app.members SET pause_chat=false WHERE id=$1', [p.a.memberId]);
  expect((await db.view(p.b, p.id)).status).toBe('UNAVAILABLE');
  await f.accounts.changePolicy(p.a, randomUUID(), {
    action: 'RESUME',
    version: (await f.accounts.policy(p.a.memberId)).version,
  });
  await f.accounts.changePolicy(p.a, randomUUID(), {
    action: 'FOCUS',
    version: (await f.accounts.policy(p.a.memberId)).version,
  });
  await open(p.b, p.id);
  const key = randomUUID();
  await f.explore.close(p.a, p.id, key);
  await f.explore.close(p.a, p.id, key);
  expect((await db.view(p.b, p.id)).status).toBe('ENDED');
  expect(
    (
      await f.admin.query('SELECT held FROM app.capacity_ledger WHERE member_id IN($1,$2)', [
        p.a.memberId,
        p.b.memberId,
      ])
    ).rows.map((r) => r.held),
  ).toEqual([0, 0]);
  expect(
    (
      await f.admin.query('SELECT reason FROM app.opportunity_closures WHERE opportunity_id=$1', [
        p.id,
      ])
    ).rows[0].reason,
  ).toBe('CLOSED');
});
it('I-09 a plan needs no chat, both confirm the same revision, retries are idempotent, and a second plan offers opt-in Focus', async () => {
  const p = await f.pair(),
    plan = await f.proposed(p),
    key = randomUUID();
  await db.plan(p.a, p.id, key, { action: 'CONFIRM', planId: plan.id, revision: 1 });
  await db.plan(p.a, p.id, key, { action: 'CONFIRM', planId: plan.id, revision: 1 });
  expect((await open(p.b, p.id)).plans[0]!.state).toBe('PROPOSED');
  await db.plan(p.b, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 1 });
  const v = await open(p.a, p.id);
  expect(v.messages).toHaveLength(0);
  expect(v.plans[0]!.state).toBe('CONFIRMED');
  expect(v.focusOffer).toBe(false);
  expect((await db.calendar(p.a, p.id, plan.id)).ics).toContain('BEGIN:VEVENT');
  const second = await f.proposed(p, {
    ...f.time(),
    start: new Date(new Date(f.time().start).getTime() + 86400000).toISOString(),
  });
  for (const member of [p.a, p.b])
    await db.plan(member, p.id, randomUUID(), {
      action: 'CONFIRM',
      planId: second.id,
      revision: 1,
    });
  expect((await open(p.a, p.id)).focusOffer).toBe(true);
  expect((await f.accounts.policy(p.a.memberId)).intent).toBe('EXPLORE');
  expect(
    (await f.admin.query('SELECT held FROM app.capacity_ledger WHERE member_id=$1', [p.a.memberId]))
      .rows[0].held,
  ).toBe(1);
});
it('I-09 I-20 full venue review is audited; private fields and learning access stay separated; revoked operators cannot read', async () => {
  const p = await f.pair();
  expect(
    (await f.venues.list(p.staff, randomUUID())).find((v) => v.id === p.venue.id)!.partnerContact,
  ).toBe(p.venue.partnerContact);
  const options = await db.options(p.a, p.id, randomUUID(), f.time());
  expect(JSON.stringify(options)).not.toContain(p.venue.partnerContact);
  expect(JSON.stringify(options)).not.toContain('centroid');
  for (const role of [f.app, f.learning])
    await expect(role.query('SELECT * FROM ops.venue_private')).rejects.toMatchObject({
      code: '42501',
    });
  expect(
    (
      await f.ops.query(
        "SELECT action FROM ops.audit WHERE subject_id=$1 AND action='VENUE_READ'",
        [p.venue.id],
      )
    ).rowCount,
  ).toBe(1);
  await f.admin.query('DELETE FROM ops.staff WHERE member_id=$1', [p.staff.memberId]);
  await expect(f.venues.list(p.staff, randomUUID())).rejects.toThrow('FORBIDDEN');
});
it('I-09 venue choices stay stable after area edits; expired reviews and the venue switch exclude suggestions and invalidate plans', async () => {
  const p = await f.pair(),
    other = syntheticVenue();
  other.name = 'Synthetic second venue';
  await f.venues.save(p.staff, randomUUID(), other, randomUUID());
  const choices = await db.options(p.a, p.id, randomUUID(), f.time()),
    plan = await f.proposed(p);
  await f.accounts.saveProfile(p.a.memberId, randomUUID(), 1, {
    ...syntheticProfile,
    areaId: 'greenwich-village',
  });
  expect((await db.options(p.a, p.id, randomUUID(), f.time())).venues.map((v) => v.id)).toEqual(
    choices.venues.map((v) => v.id),
  );
  await f.safetyStore.switch(
    p.staff,
    randomUUID(),
    { scope: 'VENUE', target: p.venue.id, disabled: true, version: 0 },
    randomUUID(),
  );
  expect((await open(p.b, p.id)).plans.find((v) => v.id === plan.id)!.state).toBe('INVALIDATED');
  expect(
    (await db.options(p.b, p.id, randomUUID(), f.time())).venues.map((v) => v.id),
  ).not.toContain(p.venue.id);
  await expect(
    db.plan(p.a, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 1 }),
  ).rejects.toThrow('STALE_VERSION');
  await f.admin.query(
    "UPDATE app.explore_venues SET review_expires_at=now()-interval '1 second' WHERE id=$1",
    [other.id],
  );
  expect(
    (await db.options(p.a, p.id, randomUUID(), { ...f.time(), refresh: randomUUID() })).venues,
  ).toHaveLength(0);
});
it('I-09 different-version confirmations racing cannot combine consent; cancel racing confirm cannot revive a plan', async () => {
  const p = await f.pair(),
    plan = await f.proposed(p),
    options = await db.options(p.a, p.id, randomUUID(), { ...f.time(), minutes: 45 });
  await db.plan(p.a, p.id, randomUUID(), {
    action: 'CHANGE',
    planId: plan.id,
    version: 0,
    optionsId: options.id,
    venueId: p.venue.id,
  });
  const results = await Promise.allSettled([
    db.plan(p.a, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 1 }),
    db.plan(p.b, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 2 }),
  ]);
  expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
  let v = (await open(p.a, p.id)).plans[0]!;
  expect(v.state).toBe('PROPOSED');
  const race = await Promise.allSettled([
    db.plan(p.b, p.id, randomUUID(), { action: 'CANCEL', planId: plan.id, version: v.version }),
    db.plan(p.a, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 2 }),
  ]);
  v = (await open(p.a, p.id)).plans[0]!;
  if (race[0]!.status === 'fulfilled') expect(v.state).toBe('CANCELLED');
  else {
    expect(race[1]!.status).toBe('fulfilled');
    expect(v.state).toBe('CONFIRMED');
  }
  if (v.state !== 'CANCELLED')
    await db.plan(p.a, p.id, randomUUID(), {
      action: 'CANCEL',
      planId: plan.id,
      version: v.version,
    });
  expect(race.some((r) => r.status === 'fulfilled')).toBe(true);
  await expect(
    db.plan(p.a, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 2 }),
  ).rejects.toThrow('STALE_VERSION');
});
it.each(['delivery', 'confirmation'] as const)(
  'I-04 block during %s wins before a waiting transition can disclose or commit',
  async (stage) => {
    const p = await f.pair(),
      message = await db.send(p.a, p.id, randomUUID(), { text: 'Synthetic queued message' }),
      plan = await f.proposed(p),
      barrier = await f.admin.connect();
    await barrier.query('BEGIN');
    await barrier.query('SELECT app.lock_pair($1,$2)', [p.a.memberId, p.b.memberId]);
    const result = (
      stage === 'delivery'
        ? db.deliverOne(message.id)
        : db.plan(p.b, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 1 })
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await waiting();
    await barrier.query(
      'INSERT INTO app.blocks(low_id,high_id,blocker_id) VALUES(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),$1)',
      [p.a.memberId, p.b.memberId],
    );
    await barrier.query('COMMIT');
    barrier.release();
    const outcome = await result;
    if (stage === 'delivery') expect(outcome).toEqual({ value: false });
    else expect('error' in outcome && outcome.error.message).toBe('CONNECTION_ENDED');
    expect(
      (await f.admin.query('SELECT state FROM app.messages WHERE id=$1', [message.id])).rows[0]
        .state,
    ).toBe('CANCELLED');
    expect((await db.view(p.b, p.id)).status).toBe('ENDED');
  },
);
it.each(['delivery', 'confirmation'] as const)(
  'I-04 block waits for already locked %s then removes all access and cancels the plan',
  async (stage) => {
    const p = await f.pair(),
      message = await db.send(p.a, p.id, randomUUID(), { text: 'Synthetic in-flight message' }),
      plan = await f.proposed(p),
      barrier = await f.admin.connect();
    await barrier.query('BEGIN');
    if (stage === 'delivery')
      await barrier.query('SELECT id FROM app.messages WHERE id=$1 FOR UPDATE', [message.id]);
    else await barrier.query('SELECT id FROM app.plans WHERE id=$1 FOR UPDATE', [plan.id]);
    const transition =
      stage === 'delivery'
        ? db.deliverOne(message.id)
        : db.plan(p.a, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 1 });
    await waiting();
    const blocked = blockMember(f.accounts, p.b, p.a.memberId, randomUUID());
    await waiting(2);
    await barrier.query('COMMIT');
    barrier.release();
    await transition;
    await blocked;
    expect((await db.view(p.a, p.id)).status).toBe('ENDED');
    expect(
      (await f.admin.query('SELECT state FROM app.plans WHERE id=$1', [plan.id])).rows[0].state,
    ).toBe('CANCELLED');
  },
);
it.each(['closure-first', 'confirmation-first'] as const)(
  'I-09 %s venue closure race cannot leave a confirmed plan at a disabled venue',
  async (order) => {
    const p = await f.pair(),
      plan = await f.proposed(p);
    await db.plan(p.a, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 1 });
    const barrier = await f.admin.connect();
    await barrier.query('BEGIN');
    if (order === 'closure-first') await barrier.query('SELECT pg_advisory_xact_lock(40,1)');
    else await barrier.query('SELECT id FROM app.plans WHERE id=$1 FOR UPDATE', [plan.id]);
    const confirmed = db
      .plan(p.b, p.id, randomUUID(), { action: 'CONFIRM', planId: plan.id, revision: 1 })
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waiting();
    if (order === 'closure-first') {
      await barrier.query(
        'UPDATE app.explore_venues SET approved=false,version=version+1 WHERE id=$1',
        [p.venue.id],
      );
      await barrier.query('COMMIT');
      barrier.release();
      expect('error' in (await confirmed)).toBe(true);
    } else {
      const closed = f.venues.save(
        p.staff,
        randomUUID(),
        { ...p.venue, approved: false },
        randomUUID(),
      );
      await expect
        .poll(
          async () =>
            (
              await f.admin.query(
                "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='connections-test-ops' AND wait_event_type='Lock'",
              )
            ).rowCount,
        )
        .toBeGreaterThan(0);
      await barrier.query('COMMIT');
      barrier.release();
      expect('value' in (await confirmed)).toBe(true);
      await closed;
    }
    expect((await open(p.a, p.id)).plans[0]!.state).toBe('INVALIDATED');
  },
);
it('I-09 preferences invalidate future plans without exposing the other member’s boundaries', async () => {
  const p = await f.pair();
  await f.proposed(p);
  await db.savePreferences(p.b, p.id, randomUUID(), {
    version: 0,
    data: { ...defaultPlanningPreferences, accessibility: ['toilets'] },
  });
  const a = await open(p.a, p.id);
  expect(a.plans[0]!.state).toBe('INVALIDATED');
  expect(a.preferences.data.accessibility).toEqual([]);
});
it('I-04 I-09 real pg-boss delivers encrypted messages and maintains expired venue plans', async () => {
  const p = await f.pair(),
    message = await db.send(p.a, p.id, randomUUID(), { text: 'Synthetic durable message' });
  const plan = await f.proposed(p);
  // Simulate passage of the venue review clock without invoking the edit trigger.
  // This is isolated fixture setup; runtime writers cannot disable triggers.
  await f.admin.query('ALTER TABLE app.explore_venues DISABLE TRIGGER venue_plans');
  await f.admin.query(
    "UPDATE app.explore_venues SET review_expires_at=now()-interval '1 second' WHERE id=$1",
    [p.venue.id],
  );
  await f.admin.query('ALTER TABLE app.explore_venues ENABLE TRIGGER venue_plans');
  const url = new URL(f.url);
  url.searchParams.set('options', '-c role=meetwell_worker');
  const boss = await startWorker(url.toString());
  try {
    await registerConnectionJobs(boss, db);
    for (const queue of ['connections.deliver', 'connections.maintain']) {
      const job = await boss.send(queue, {});
      await expect
        .poll(
          async () =>
            (await f.admin.query('SELECT state FROM queue.job WHERE id=$1', [job])).rows[0]?.state,
          { timeout: 10000 },
        )
        .toBe('completed');
    }
    expect(
      (await f.admin.query('SELECT state FROM app.messages WHERE id=$1', [message.id])).rows[0]
        .state,
    ).toBe('DELIVERED');
    expect(
      (await f.admin.query('SELECT state FROM app.plans WHERE id=$1', [plan.id])).rows[0].state,
    ).toBe('INVALIDATED');
  } finally {
    await boss.stop({ graceful: true });
  }
});
