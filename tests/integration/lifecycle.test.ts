import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import { connectionFixture } from '../fixtures/connections-db';
import { FeedbackStore } from '../../packages/db/src/feedback';
import { PrivacyStore, LifecycleStore } from '../../packages/db/src/lifecycle';
import { MetricStore, refreshMetrics } from '../../packages/db/src/metrics';
import { LifecycleArtifacts } from '../../packages/runtime/src/lifecycle-artifacts';
import { putPhoto, deletePhoto, mediaVersions } from '../../packages/runtime/src/media-storage';
import { Envelope } from '../../packages/db/src/encryption';
import { blockMember } from '../../packages/db/src/member-access';
import { backupDatabase, restoreDatabase } from '../../scripts/database-backup';
import { replayDeletions } from '../../scripts/replay-deletions';
import { pilot, retention } from '../../packages/config/src/pilot';
const f = connectionFixture(),
  feedback = new FeedbackStore(f.accounts),
  privacy = new PrivacyStore(f.accounts),
  metrics = new MetricStore(f.accounts);
const key = randomBytes(32).toString('base64');
let directory: string, artifacts: LifecycleArtifacts, lifecycle: LifecycleStore;
beforeAll(async () => {
  await f.start();
  directory = await mkdtemp(join(tmpdir(), 'meetwell-lifecycle-'));
  artifacts = new LifecycleArtifacts(join(directory, 'journal'), join(directory, 'exports'), key);
  await artifacts.initialize();
  lifecycle = new LifecycleStore(f.worker, f.accounts, artifacts, deletePhoto);
});
afterAll(async () => {
  await f.stop();
  await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await f.admin.query("UPDATE app.members SET state='PAUSED' WHERE state='ACTIVE'");
  await f.admin.query('UPDATE app.explore_venues SET approved=false WHERE approved');
});
const yes = { met: 'YES', again: 'YES', chips: ['Easy conversation'] };
it('I-18 media purge removes historical encrypted versions and delete markers from real versioned storage', async () => {
  const endpoint = process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
  if (!['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname))
    throw Error('Local synthetic storage required');
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MEDIA_ACCESS_KEY!,
      secretAccessKey: process.env.MEDIA_SECRET_KEY!,
    },
  });
  const bucket = `meetwell-lifecycle-${randomUUID()}`,
    id = randomUUID(),
    previous = process.env.MEDIA_BUCKET;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  process.env.MEDIA_BUCKET = bucket;
  try {
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
    await putPhoto(id, Buffer.from('first synthetic version'));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: id }));
    await putPhoto(id, Buffer.from('second synthetic version'));
    expect((await mediaVersions(id)).length).toBe(3);
    await deletePhoto(id);
    expect(await mediaVersions(id)).toEqual([]);
  } finally {
    await deletePhoto(id);
    if (previous === undefined) delete process.env.MEDIA_BUCKET;
    else process.env.MEDIA_BUCKET = previous;
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    client.destroy();
  }
});
it('I-12 P26 expired or partial-consent attention windows remain unknown, never zero-cost meetings', async () => {
  for (const [age, consentAge, expected] of [
    [31, 35, null],
    [1, 0, null],
    [1, 2, 0],
  ] as const) {
    const member = await f.member(),
      id = randomUUID();
    await f.admin.query(
      "INSERT INTO ops.metric_cohorts(id,started_at,denominator,policy_version,thresholds) VALUES($1,clock_timestamp()-$2*interval '1 day',1,'synthetic-fixture',$3)",
      [id, age, JSON.stringify(pilot)],
    );
    await f.admin.query('INSERT INTO ops.metric_members(cohort_id,member_id) VALUES($1,$2)', [
      id,
      member.memberId,
    ]);
    await f.admin.query(
      "INSERT INTO app.attention_consent(member_id,enabled,updated_at) VALUES($1,true,clock_timestamp()-$2*interval '1 day')",
      [member.memberId, consentAge],
    );
    const data = (
      await f.worker.query('SELECT ops.metric_input($1,$2) AS data', [
        id,
        JSON.stringify(retention),
      ])
    ).rows[0].data;
    expect(data.members[0].activeSeconds).toBe(expected);
  }
});
async function encounter() {
  const p = await f.pair(),
    plan = await f.proposed(p);
  for (const a of [p.a, p.b])
    await f.connections.plan(a, p.id, randomUUID(), {
      action: 'CONFIRM',
      planId: plan.id,
      revision: 1,
    });
  const id = (
    await f.admin.query<{ id: string }>(
      "UPDATE app.encounters SET start_at=clock_timestamp()-interval '2 days' WHERE plan_id=$1 RETURNING id",
      [plan.id],
    )
  ).rows[0]!.id;
  await feedback.maintain();
  return { ...p, encounter: id, plan: plan.id };
}
it('I-10 I-11 I-12 I-19 morning-after answers are private, optional, once-only and cannot send invitations or reveal a mutual Yes', async () => {
  const p = await encounter(),
    stranger = await f.member();
  expect((await feedback.list(p.a)).find((x) => x.id === p.encounter)).toMatchObject({
    presented: false,
    answer: null,
  });
  await feedback.present(p.a, p.encounter, randomUUID(), false);
  await feedback.maintain();
  expect(
    (await f.app.query('SELECT 1 FROM app.feedback_prompts WHERE encounter_id=$1', [p.encounter]))
      .rowCount,
  ).toBe(2);
  const command = randomUUID();
  expect(await feedback.answer(p.a, p.encounter, command, yes)).toEqual({ saved: true });
  expect(await feedback.answer(p.a, p.encounter, command, yes)).toEqual({ saved: true });
  expect((await feedback.list(p.b))[0]!.answer).toBeNull();
  await expect(feedback.answer(stranger, p.encounter, randomUUID(), yes)).rejects.toThrow(
    'NOT_FOUND',
  );
  await feedback.answer(p.b, p.encounter, randomUUID(), { ...yes, chips: ['Felt attraction'] });
  const own = (await feedback.list(p.a)).find((x) => x.id === p.encounter)!;
  expect(own.answer).toEqual(yes);
  expect(JSON.stringify(own)).not.toContain('Felt attraction');
  expect(
    (await f.app.query('SELECT 1 FROM app.messages WHERE connection_id=$1', [p.id])).rowCount,
  ).toBe(0);
  expect(
    (
      await f.learning.query(
        "SELECT provenance,attended FROM learning.logistics WHERE encounter_id=$1 AND event='ATTENDANCE' ORDER BY occurred_at DESC LIMIT 1",
        [p.encounter],
      )
    ).rows[0],
  ).toEqual({ provenance: 'BOTH_REPORTED', attended: true });
  const invitation = await feedback.invite(p.a, p.id, randomUUID());
  await blockMember(f.accounts, p.b, p.a.memberId, randomUUID());
  expect(await f.connections.deliverOne(invitation.id)).toBe(false);
  await expect(feedback.invite(p.a, p.id, randomUUID())).rejects.toThrow();
  const report = await f.safetyStore.report(
    p.a,
    randomUUID(),
    {
      subjectId: p.b.memberId,
      detail: 'Synthetic safety canary',
      context: { surface: 'post-meeting' },
    },
    randomUUID(),
  );
  expect(report.status).toBe('RECEIVED');
  for (const pool of [f.app, f.learning, f.worker])
    await expect(pool.query('SELECT detail_cipher FROM safety.report')).rejects.toMatchObject({
      code: '42501',
    });
  await expect(
    f.learning.query('DELETE FROM learning.experience WHERE encounter_id=$1', [p.encounter]),
  ).rejects.toMatchObject({ code: '42501' });
});
it('I-10 P17 unanswered, abstained and disputed meetings remain distinct; future and cancelled plans do not prompt', async () => {
  const p = await encounter();
  await feedback.present(p.a, p.encounter, randomUUID(), true);
  await feedback.answer(p.b, p.encounter, randomUUID(), {
    met: 'PREFER_NOT_TO_SAY',
    again: null,
    chips: [],
  });
  expect(
    (
      await f.learning.query(
        "SELECT provenance,attended FROM learning.logistics WHERE encounter_id=$1 AND event='ATTENDANCE'",
        [p.encounter],
      )
    ).rows[0],
  ).toEqual({ provenance: 'UNKNOWN', attended: null });
  const q = await encounter();
  await feedback.answer(q.a, q.encounter, randomUUID(), yes);
  await feedback.answer(q.b, q.encounter, randomUUID(), { met: 'NO', again: null, chips: [] });
  expect(
    (
      await f.learning.query(
        "SELECT provenance,attended FROM learning.logistics WHERE encounter_id=$1 AND event='ATTENDANCE' ORDER BY occurred_at DESC LIMIT 1",
        [q.encounter],
      )
    ).rows[0],
  ).toEqual({ provenance: 'DISPUTED', attended: null });
  const future = await f.proposed(q);
  for (const a of [q.a, q.b])
    await f.connections.plan(a, q.id, randomUUID(), {
      action: 'CONFIRM',
      planId: future.id,
      revision: 1,
    });
  await feedback.maintain();
  expect((await feedback.list(q.a)).length).toBe(1);
  await f.explore.close(q.a, q.id, randomUUID());
  expect(
    (await f.admin.query('SELECT eligible FROM app.encounters WHERE plan_id=$1', [future.id]))
      .rows[0].eligible,
  ).toBe(false);
  expect((await feedback.list(q.a)).length).toBe(1); // past meeting survives unmatch
});
it('I-10 P13 success exits save separate consents atomically; follow-up silence stays UNKNOWN, revocation wins and receipts reject altered consents', async () => {
  const a = await f.member(),
    command = randomUUID(),
    version = (await f.accounts.policy(a.memberId)).version;
  const exit = { version, meaningfulConnection: true, followup30: true, followup90: false };
  await feedback.exit(a, command, exit);
  await feedback.exit(a, command, exit);
  await expect(feedback.exit(a, command, { ...exit, followup90: true })).rejects.toThrow(
    'IDEMPOTENCY_CONFLICT',
  );
  expect(await feedback.followups(a)).toMatchObject([
    { day: 30, answer: 'UNKNOWN', revoked: false },
  ]);
  await expect(
    feedback.followup(a, 30, randomUUID(), { action: 'ANSWER', answer: 'ENDED' }),
  ).rejects.toThrow('NOT_FOUND');
  await f.admin.query(
    "UPDATE app.outcome_followups SET due_at=clock_timestamp()-interval '1 day' WHERE member_id=$1",
    [a.memberId],
  );
  await feedback.followup(a, 30, randomUUID(), { action: 'REVOKE' });
  await expect(
    feedback.followup(a, 30, randomUUID(), { action: 'ANSWER', answer: 'ENDED' }),
  ).rejects.toThrow('NOT_FOUND');
  expect((await feedback.followups(a))[0]).toMatchObject({ answer: 'UNKNOWN', revoked: true });
});
it('I-18 I-12 erasure removes primary records, media versions, snapshots and batch payloads; its independent receipt survives revoked sign-in', async () => {
  const p = await encounter();
  const unrelated = await f.pair(),
    retryKey = randomUUID(),
    originalMessage = await f.connections.send(unrelated.a, unrelated.id, retryKey, {
      text: 'Synthetic retry survives unrelated deletion',
    });
  await feedback.answer(p.a, p.encounter, randomUUID(), yes);
  await feedback.attention(p.a, randomUUID(), { action: 'CONSENT', enabled: true });
  await feedback.attention(p.a, randomUUID(), { action: 'RECORD', seconds: 20 });
  const photos = (
    await f.app.query<{ id: string }>('SELECT id FROM app.media WHERE member_id=$1', [p.a.memberId])
  ).rows;
  await f.accounts.rateLimit('auth:global', 100, 3600);
  const globalBudget = (
    await f.identity.query("SELECT requests FROM identity.rate_limits WHERE bucket='auth:global'")
  ).rows[0].requests;
  await putPhoto(photos[0]!.id, Buffer.from('synthetic encrypted media'));
  const report = await f.safetyStore.report(
    p.b,
    randomUUID(),
    {
      subjectId: p.a.memberId,
      detail: 'isolated safety canary',
      context: { surface: 'post-meeting' },
    },
    randomUUID(),
  );
  const exported = await lifecycle.exportLearning(),
    ciphertext = await readFile(join(directory, 'exports', exported.file), 'utf8');
  expect(ciphertext).not.toContain('isolated safety canary');
  expect(ciphertext).not.toContain(p.a.memberId);
  const snapshot = new Envelope(key).open<{ data: Record<string, Record<string, unknown>[]> }>(
    ciphertext,
    `snapshot:${exported.id}`,
  );
  expect(Object.keys(snapshot.data).sort()).toEqual([
    'experience',
    'logistics',
    'selectionDecisions',
    'selectionExposures',
  ]);
  for (const rows of Object.values(snapshot.data))
    for (const row of rows)
      expect(Object.keys(row).join(' ')).not.toMatch(
        /email|name|birth|location|venue|detail|cipher|context|message|demograph|latitude|longitude/i,
      );
  const result = await privacy.request(
    p.a,
    randomUUID(),
    (await f.accounts.policy(p.a.memberId)).version,
  );
  expect(await privacy.receipt(result.token)).toMatchObject({ status: 'PENDING' });
  await expect(feedback.list(p.a)).rejects.toThrow('UNAUTHORIZED');
  await expect(lifecycle.exportLearning()).rejects.toThrow('pending erasures');
  expect(await lifecycle.eraseOne()).toBe(true);
  expect(
    (await f.identity.query("SELECT requests FROM identity.rate_limits WHERE bucket='auth:global'"))
      .rows[0].requests,
  ).toBe(globalBudget);
  expect(
    await f.connections.send(unrelated.a, unrelated.id, retryKey, {
      text: 'Synthetic retry survives unrelated deletion',
    }),
  ).toEqual(originalMessage);
  expect(
    (await f.app.query('SELECT 1 FROM app.messages WHERE connection_id=$1', [unrelated.id]))
      .rowCount,
  ).toBe(1);
  expect(await privacy.receipt(result.token)).toMatchObject({
    status: 'COMPLETED',
  });
  expect((await mediaVersions(photos[0]!.id)).length).toBe(0);
  expect(await readdir(join(directory, 'exports'))).toEqual([]);
  for (const [table, column] of [
    ['identity.users', 'id'],
    ['identity.sessions', 'member_id'],
    ['identity.consents', 'member_id'],
    ['app.members', 'id'],
    ['app.profiles', 'member_id'],
    ['app.preference_versions', 'member_id'],
    ['app.media', 'member_id'],
    ['app.matching_feedback', 'member_id'],
    ['app.attention_minutes', 'member_id'],
    ['learning.experience', 'member_id'],
    ['ops.metric_members', 'member_id'],
  ])
    expect(
      (await f.admin.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [p.a.memberId])).rowCount,
      table,
    ).toBe(0);
  expect(
    (await f.safety.query('SELECT 1 FROM safety.report WHERE id=$1', [report.id])).rowCount,
  ).toBe(1);
  const batchRows = (
    await f.worker.query<{ id: string; summary_cipher: string }>(
      'SELECT * FROM ops.erasure_batches()',
    )
  ).rows;
  for (const b of batchRows)
    expect(
      JSON.stringify(f.accounts.appCipher.open(b.summary_cipher, `batch:${b.id}`)),
    ).not.toContain(p.a.memberId);
  expect(
    (
      await f.app.query('SELECT 1 FROM app.pair_history WHERE $1 IN(low_id,high_id)', [
        p.a.memberId,
      ])
    ).rowCount,
  ).toBeGreaterThan(0);
  expect((await artifacts.readJournal()).entries.some((t) => t.memberId === p.a.memberId)).toBe(
    true,
  );
  await expect(
    f.worker.query('SELECT ops.erase_primary($1,$2)', [
      p.b.memberId,
      retention.D9_SAFETY_AFTER_CLOSURE_MONTHS,
    ]),
  ).rejects.toThrow('Durable tombstone required');
  await expect(
    f.app.query('INSERT INTO app.members(id) VALUES($1)', [p.a.memberId]),
  ).rejects.toThrow('Identifier retired');
  expect(
    (
      await f.safetyStore.report(
        p.b,
        randomUUID(),
        {
          subjectId: p.a.memberId,
          detail: 'after deletion',
          context: { surface: 'after-unmatch' },
        },
        randomUUID(),
      )
    ).status,
  ).toBe('RECEIVED');
});
it('I-18 deletion versus export is serialized; a failed external purge cannot claim completion or restore access', async () => {
  const p = await encounter(),
    requested = await privacy.request(
      p.a,
      randomUUID(),
      (await f.accounts.policy(p.a.memberId)).version,
    );
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      entered = r;
    });
  const paused = new LifecycleStore(
    f.worker,
    f.accounts,
    {
      ...artifacts,
      remember: async (t) => {
        await artifacts.remember(t);
        entered();
        await gate;
      },
      purgeSnapshots: () => artifacts.purgeSnapshots(),
      writeSnapshot: (...a) => artifacts.writeSnapshot(...a),
    },
    deletePhoto,
  );
  const erasing = paused.eraseOne();
  void erasing.catch(() => undefined); // Always observed below, even if the concurrent assertion fails.
  await ready;
  const exporting = lifecycle.exportLearning();
  void exporting.catch(() => undefined);
  try {
    await expect
      .poll(async () =>
        Number(
          (
            await f.admin.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='connections-test-worker' AND wait_event_type='Lock'",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
  } finally {
    release();
  }
  await erasing;
  const snapshot = await exporting;
  const value = new Envelope(key).open(
    await readFile(join(directory, 'exports', snapshot.file), 'utf8'),
    `snapshot:${snapshot.id}`,
  );
  expect(JSON.stringify(value)).not.toContain(p.a.memberId);
  expect((await privacy.receipt(requested.token)).status).toBe('COMPLETED');
  const b = await f.member(),
    r = await privacy.request(b, randomUUID(), (await f.accounts.policy(b.memberId)).version);
  const failure = new LifecycleStore(f.worker, f.accounts, artifacts, async () => {
    throw Error('synthetic unavailable storage');
  });
  await expect(failure.eraseOne()).rejects.toThrow('synthetic unavailable storage');
  expect((await privacy.receipt(r.token)).status).toBe('PENDING');
  await expect(feedback.list(b)).rejects.toThrow('UNAUTHORIZED');
  await lifecycle.eraseOne();
});
it('I-18 P22 D5 D8 D11 D12 D13 retention purges expired rows without inventing outcomes', async () => {
  const p = await encounter();
  const old = randomUUID();
  await f.admin.query(
    "INSERT INTO app.encounters(id,plan_id,revision,connection_id,low_id,high_id,start_at,timezone) VALUES($1,$2,1,$3,$4,$5,clock_timestamp()-interval '181 days','America/New_York')",
    [old, randomUUID(), p.id, ...[p.a.memberId, p.b.memberId].sort()],
  );
  await f.admin.query(
    "INSERT INTO app.matching_feedback(encounter_id,member_id,body_cipher,created_at) VALUES($1,$2,$3,clock_timestamp()-interval '181 days')",
    [old, p.a.memberId, f.accounts.appCipher.seal(yes, `feedback:${old}:${p.a.memberId}`)],
  );
  await f.admin.query(
    "INSERT INTO learning.experience(encounter_id,member_id,event,observed_at) VALUES($1,$2,'PROMPT',clock_timestamp()-interval '181 days')",
    [old, p.a.memberId],
  );
  await f.admin.query(
    "INSERT INTO learning.logistics(encounter_id,low_id,high_id,event,provenance,occurred_at) VALUES($1,$2,$3,'CONFIRMED','UNKNOWN',clock_timestamp()-interval '181 days')",
    [old, ...[p.a.memberId, p.b.memberId].sort()],
  );
  const message = await f.connections.send(p.a, p.id, randomUUID(), {
    text: 'Synthetic expired chat',
  });
  await f.admin.query(
    "UPDATE app.connections SET closed_at=clock_timestamp()-interval '91 days' WHERE id=$1",
    [p.id],
  );
  const bucket = `synthetic-retention-${randomUUID()}`;
  await f.admin.query(
    "INSERT INTO identity.rate_limits(bucket,window_start,requests) VALUES($1,clock_timestamp()-interval '31 days',1)",
    [bucket],
  );
  await lifecycle.retain();
  for (const table of ['app.matching_feedback', 'learning.experience', 'learning.logistics'])
    expect(
      (await f.admin.query(`SELECT 1 FROM ${table} WHERE encounter_id=$1`, [old])).rowCount,
      table,
    ).toBe(0);
  expect((await f.admin.query('SELECT 1 FROM app.encounters WHERE id=$1', [old])).rowCount).toBe(0);
  expect(
    (await f.admin.query('SELECT 1 FROM app.messages WHERE id=$1', [message.id])).rowCount,
  ).toBe(0);
  expect((await f.admin.query('SELECT 1 FROM app.plans WHERE id=$1', [p.plan])).rowCount).toBe(0);
  expect(
    (await f.admin.query('SELECT 1 FROM identity.rate_limits WHERE bucket=$1', [bucket])).rowCount,
  ).toBe(0);
  expect((await f.admin.query('SELECT 1 FROM ops.privacy_reviews')).rowCount).toBe(3);
});
it('I-18 I-20 D9 expiry respects case-specific legal holds, annual reviews and safety-only access', async () => {
  const p = await f.pair(),
    r = await f.safetyStore.report(
      p.a,
      randomUUID(),
      { subjectId: p.b.memberId, detail: 'retention canary', context: { surface: 'settings' } },
      randomUUID(),
    );
  await f.admin.query(
    "UPDATE safety.report SET status='CLOSED',closed_at=clock_timestamp()-interval '25 months',created_at=clock_timestamp()-interval '26 months' WHERE id=$1",
    [r.id],
  );
  const until = new Date(Date.now() + 86400000 * 30).toISOString(),
    review = new Date(Date.now() + 86400000).toISOString();
  await f.safetyStore.hold(
    p.staff,
    randomUUID(),
    {
      action: 'SET',
      kind: 'report',
      recordId: r.id,
      version: 0,
      reason: 'Synthetic case-specific legal instruction',
      until,
      review,
    },
    randomUUID(),
  );
  await lifecycle.retain();
  expect((await f.safety.query('SELECT 1 FROM safety.report WHERE id=$1', [r.id])).rowCount).toBe(
    1,
  );
  const requestId = randomUUID();
  expect((await f.safetyStore.retentionQueue(p.staff, requestId)).some((x) => x.id === r.id)).toBe(
    true,
  );
  expect(
    (
      await f.safety.query(
        'SELECT 1 FROM safety.case_access_audit WHERE request_id=$1 AND record_id=$2',
        [requestId, r.id],
      )
    ).rowCount,
  ).toBe(1);
  for (const pool of [f.app, f.learning, f.worker])
    await expect(pool.query('SELECT reason_cipher FROM safety.legal_holds')).rejects.toMatchObject({
      code: '42501',
    });
  await f.safetyStore.hold(
    p.staff,
    randomUUID(),
    { action: 'RELEASE', kind: 'report', recordId: r.id, version: 1 },
    randomUUID(),
  );
  await lifecycle.retain();
  expect((await f.safety.query('SELECT 1 FROM safety.report WHERE id=$1', [r.id])).rowCount).toBe(
    0,
  );
  await f.admin.query('DELETE FROM ops.staff WHERE member_id=$1', [p.staff.memberId]);
  await expect(f.safetyStore.retentionQueue(p.staff, randomUUID())).rejects.toThrow('FORBIDDEN');
});
it('I-18 P22 restoring an older backup cannot serve until the latest independent journal is replayed', async () => {
  const p = await encounter(),
    archive = join(directory, `${randomUUID()}.mwbackup`),
    backupKey = randomBytes(32).toString('base64');
  await backupDatabase(f.url, archive, backupKey);
  // Enforcement occurred after the backup and cannot be inferred from it.
  await f.safety.query(
    'INSERT INTO safety.enforcement(member_id,restricted,version) VALUES($1,true,1)',
    [p.a.memberId],
  );
  await privacy.request(p.a, randomUUID(), (await f.accounts.policy(p.a.memberId)).version);
  await lifecycle.eraseOne();
  const digest = (await artifacts.readJournal()).digest,
    restored = await restoreDatabase(f.url, archive, backupKey),
    target = new URL(f.url);
  target.pathname = `/${restored}`;
  const pool = new Pool({ connectionString: target.toString() });
  try {
    expect(
      (await pool.query('SELECT 1 FROM app.profiles WHERE member_id=$1', [p.a.memberId])).rowCount,
    ).toBe(1);
    await expect(pool.query('SELECT app.assert_serving_ready()')).rejects.toThrow(
      'RESTORE_QUARANTINED',
    );
    await expect(
      replayDeletions(
        target.toString(),
        f.accounts,
        artifacts,
        '0'.repeat(64),
        deletePhoto,
        f.admin,
      ),
    ).rejects.toThrow('Latest independent journal');
    await expect(pool.query('SELECT app.assert_serving_ready()')).rejects.toThrow(
      'RESTORE_QUARANTINED',
    );
    await expect(
      replayDeletions(target.toString(), f.accounts, artifacts, digest, deletePhoto, pool),
    ).rejects.toThrow('Independent current safety source');
    await replayDeletions(target.toString(), f.accounts, artifacts, digest, deletePhoto, f.admin);
    expect(
      (
        await pool.query('SELECT identity.signup_denied($1) AS denied', [
          f.accounts.lookup(`${p.a.memberId}@synthetic.invalid`),
        ])
      ).rows[0].denied,
    ).toBe(true);
    await expect(pool.query('SELECT app.assert_serving_ready()')).resolves.toBeDefined();
    expect(
      (await pool.query('SELECT 1 FROM app.profiles WHERE member_id=$1', [p.a.memberId])).rowCount,
    ).toBe(0);
    expect(
      (await pool.query('SELECT 1 FROM identity.users WHERE id=$1', [p.a.memberId])).rowCount,
    ).toBe(0);
  } finally {
    await pool.end();
    expect(restored).toMatch(/^meetwell_restore_[a-f0-9]{32}$/);
    await f.admin.query(`DROP DATABASE "${restored}" WITH (FORCE)`);
  }
}, 90000);
it('I-12 I-20 P26 cohorts are disjoint and fixed, small cells are suppressed, and revoked staff cannot read metrics', async () => {
  const p = await f.pair(),
    id = randomUUID();
  await metrics.freeze(p.staff, id, randomUUID());
  await metrics.freeze(p.staff, id, randomUUID());
  const before = (
    await f.admin.query('SELECT denominator FROM ops.metric_cohorts WHERE id=$1', [id])
  ).rows[0].denominator;
  await expect(
    metrics.review(
      p.staff,
      randomUUID(),
      { gate: 'OPERATIONS', passed: true, evidence: 'Synthetic operations drill', version: 0 },
      randomUUID(),
    ),
  ).rejects.toThrow('FORBIDDEN');
  await f.admin.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'admin')", [
    p.staff.memberId,
  ]);
  const reviewKey = randomUUID();
  await metrics.review(
    p.staff,
    reviewKey,
    { gate: 'OPERATIONS', passed: false, evidence: 'Synthetic unstaffed pilot', version: 0 },
    randomUUID(),
  );
  await metrics.review(
    p.staff,
    reviewKey,
    { gate: 'OPERATIONS', passed: false, evidence: 'Synthetic unstaffed pilot', version: 0 },
    randomUUID(),
  );
  expect((await metrics.readiness(p.staff, randomUUID()))[0]).toMatchObject({
    passed: false,
    version: 1,
  });
  await refreshMetrics(f.worker, f.accounts);
  const row = (await metrics.list(p.staff, randomUUID())).find((r) => r.id === id)!;
  expect(row.body.primary).toBeNull();
  expect(row.body.gates.every((g: { result: string }) => g.result === 'FAIL')).toBe(true);
  await privacy.request(p.a, randomUUID(), (await f.accounts.policy(p.a.memberId)).version);
  await lifecycle.eraseOne();
  expect(
    (await f.admin.query('SELECT denominator FROM ops.metric_cohorts WHERE id=$1', [id])).rows[0]
      .denominator,
  ).toBe(before);
  const next = randomUUID();
  await metrics.freeze(p.staff, next, randomUUID());
  expect(
    (await f.admin.query('SELECT denominator FROM ops.metric_cohorts WHERE id=$1', [next])).rows[0]
      .denominator,
  ).toBe(0);
  await f.admin.query('DELETE FROM ops.staff WHERE member_id=$1', [p.staff.memberId]);
  await expect(metrics.list(p.staff, randomUUID())).rejects.toThrow('FORBIDDEN');
});
