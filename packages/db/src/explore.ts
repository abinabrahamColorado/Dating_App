import { randomUUID, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pilot } from '@meetwell/config/pilot';
import { exploreConfig as c } from '@meetwell/config/explore';
import {
  allocate,
  batchSchema,
  capacitySchema,
  decisionSchema,
  decisionOutcome,
  memberStatus,
  weekKey,
  type AllocationStep,
  type ExploreMember,
  type OpportunityState,
  type Decision,
} from '@meetwell/core/explore';
import { orderedPair } from '@meetwell/core/safety';
import { AccountStore, StoreError, transaction, type Authority } from './accounts';
import {
  lockedExplorePair,
  loadExploreMember,
  loadVenues,
  databaseNow,
  ensureLedger,
} from './explore-policy';
import { withMemberPair, approvedProfileFields } from './member-access';

type Opportunity = {
  id: string;
  batch_id: string;
  low_id: string;
  high_id: string;
  state: OpportunityState;
  version: number;
  slot_held: boolean;
  reserved_week: Date | string;
  reserve_expires_at: Date;
  expires_at: Date | null;
  policy: 'algorithm' | 'operator';
  seed: string;
  step: number;
};
type Batch = {
  id: string;
  version: number;
  status: 'REVIEW' | 'APPROVED';
  policy: 'algorithm' | 'operator';
  seed: string;
  summary_cipher: string;
  creator_id: string | null;
  created_at: Date;
};
type Summary = { members: string[]; unserved: { memberId: string; reason: string }[] };
function snapshot(members: ExploreMember[]) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        members.map((m) => ({
          id: m.id,
          profile: m.profileVersion,
          preferences: m.preferenceVersion,
          policy: m.policyVersion,
        })),
      ),
    )
    .digest('hex');
}
const dateKey = (d: Date | string) =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

export class ExploreStore {
  constructor(readonly accounts: AccountStore) {}
  private async staff<T>(
    auth: Authority,
    requestId: string,
    action: string,
    run: (db: PoolClient) => Promise<T>,
    subject: string | null = null,
  ) {
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) => {
        // Take the batch lock before a staff-row lock, so two operators cannot wait
        // for one another while holding member rows required by the batch snapshot.
        await db.query('SELECT pg_advisory_xact_lock(30,1)');
        return this.accounts.withStaff(auth.memberId, ['operator', 'admin'], async (ops) => {
          const result = await run(db);
          const resultId =
            result && typeof result === 'object' && 'id' in result && typeof result.id === 'string'
              ? result.id
              : null;
          await ops.query(
            'INSERT INTO ops.audit(id,actor_id,action,request_id,subject_id) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), auth.memberId, action, requestId, subject ?? resultId],
          );
          return result;
        });
      }),
    );
  }
  private async command<T>(
    db: PoolClient,
    actor: string,
    key: string,
    payload: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const hash = this.accounts.lookup(JSON.stringify(payload));
    const old = (
      await db.query<{ request_hash: string; result_cipher: string }>(
        'SELECT request_hash,result_cipher FROM app.command_receipts WHERE member_id=$1 AND command_key=$2',
        [actor, key],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== hash) throw new StoreError('IDEMPOTENCY_CONFLICT');
      return this.accounts.appCipher.open<T>(old.result_cipher, `receipt:${actor}:${key}`);
    }
    const result = await run();
    await db.query(
      'INSERT INTO app.command_receipts(member_id,command_key,request_hash,result_cipher) VALUES($1,$2,$3,$4)',
      [actor, key, hash, this.accounts.appCipher.seal(result, `receipt:${actor}:${key}`)],
    );
    return result;
  }
  private async opportunity(db: PoolClient, id: string, actor?: string): Promise<Opportunity> {
    const row = (await db.query<Opportunity>('SELECT * FROM app.opportunities WHERE id=$1', [id]))
      .rows[0];
    if (!row || (actor && ![row.low_id, row.high_id].includes(actor)))
      throw new StoreError('NOT_FOUND');
    await db.query('SELECT app.lock_pair($1,$2)', [row.low_id, row.high_id]);
    return (
      await db.query<Opportunity>('SELECT * FROM app.opportunities WHERE id=$1 FOR UPDATE', [id])
    ).rows[0]!;
  }
  private async reserve(
    db: PoolClient,
    batch: Batch,
    u: string,
    v: string,
    step: AllocationStep | null,
    policy: 'algorithm' | 'operator',
  ) {
    const gate = await lockedExplorePair(db, this.accounts, u, v, 'RESERVATION');
    if (!gate.allowed || !gate.a || !gate.b) throw new StoreError('PAIR_INELIGIBLE');
    const [low, high] = orderedPair(u, v),
      week = weekKey(gate.now);
    for (const id of [low, high]) await ensureLedger(db, id, week);
    const ledgers = await db.query<{
      member_id: string;
      held: number;
      cap_limit: number;
      version: number;
    }>(
      'SELECT * FROM app.capacity_ledger WHERE member_id IN($1,$2) ORDER BY member_id FOR UPDATE',
      [low, high],
    );
    const budgets = await db.query<{
      member_id: string;
      pending: number;
      delivered: number;
      version: number;
    }>(
      'SELECT * FROM app.exposure_week WHERE member_id IN($1,$2) AND week=$3 ORDER BY member_id FOR UPDATE',
      [low, high, week],
    );
    if (
      ledgers.rows.some((r) => r.held >= r.cap_limit) ||
      budgets.rows.some((r) => r.pending + r.delivered >= pilot.MAX_NEW_INTROS_PER_WEEK)
    )
      throw new StoreError('CAPACITY');
    for (const ledger of ledgers.rows) {
      const changed = await db.query(
        'UPDATE app.capacity_ledger SET held=held+1,version=version+1 WHERE member_id=$1 AND version=$2',
        [ledger.member_id, ledger.version],
      );
      if (changed.rowCount !== 1) throw new StoreError('STALE_VERSION');
    }
    for (const budget of budgets.rows) {
      const changed = await db.query(
        'UPDATE app.exposure_week SET pending=pending+1,version=version+1 WHERE member_id=$1 AND week=$2 AND version=$3',
        [budget.member_id, week, budget.version],
      );
      if (changed.rowCount !== 1) throw new StoreError('STALE_VERSION');
    }
    const id = randomUUID(),
      setId = step ? randomUUID() : null;
    if (step)
      await db.query(
        'INSERT INTO app.allocation_sets(id,batch_id,step,body_cipher) VALUES($1,$2,$3,$4)',
        [setId, batch.id, step.step, this.accounts.appCipher.seal(step, `allocation:${setId}`)],
      );
    await db.query(
      `INSERT INTO app.opportunities(id,batch_id,low_id,high_id,state,reserved_week,reserve_expires_at,policy,policy_version,feature_version,feature_snapshot,retrieval_source,feasible_set_id,feasible_size,seed,step,q,branch)
   VALUES($1,$2,$3,$4,'RESERVED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        id,
        batch.id,
        low,
        high,
        week,
        new Date(gate.now.getTime() + pilot.EXPLORE_RESERVATION_HOURS * 3600000),
        policy,
        c.POLICY_VERSION,
        c.FEATURE_VERSION,
        snapshot([gate.a, gate.b]),
        policy === 'operator' ? 'operator' : 'exhaustive-declared-areas',
        setId,
        step?.size ?? 1,
        batch.seed,
        step?.step ?? 0,
        policy === 'operator' ? null : step!.q,
        step?.branch ?? 'OPERATOR',
      ],
    );
    await db.query(
      'INSERT INTO app.introduction_decisions(opportunity_id,member_id) VALUES($1,$2),($1,$3)',
      [id, low, high],
    );
    return id;
  }
  private async generateIn(
    db: PoolClient,
    seed: string,
    selected: string[] | undefined,
    creator: string | null,
    scheduled: string | null,
  ) {
    if (scheduled) {
      const old = (
        await db.query<{ id: string }>(
          'SELECT id FROM app.explore_batches WHERE scheduled_week=$1',
          [scheduled],
        )
      ).rows[0];
      if (old) return old;
    }
    let ids = selected
      ? [...new Set(selected)].sort()
      : (
          await db.query<{ id: string }>(
            "SELECT id FROM app.members WHERE state<>'EXITED' AND deletion_requested_at IS NULL ORDER BY id",
          )
        ).rows.map((r) => r.id);
    if (creator) ids = ids.filter((id) => id !== creator); // Staff cannot curate their own introductions.
    if (ids.length > pilot.EXPLORE_MAX_REVIEW_MEMBERS) throw new StoreError('BATCH_TOO_LARGE');
    for (const id of ids) await db.query('SELECT app.lock_pair($1,$1)', [id]);
    const now = await databaseNow(db),
      members: ExploreMember[] = [];
    for (const id of ids) {
      if (!(await db.query('SELECT 1 FROM app.members WHERE id=$1', [id])).rowCount) continue;
      await ensureLedger(db, id, weekKey(now));
      const member = await loadExploreMember(db, this.accounts, id, now);
      if (member) members.push(member);
    }
    const facts = [];
    // Every retrieved pair enters the authoritative locked gate, including denials.
    for (let i = 0; i < members.length; i++)
      for (const v of members.slice(i + 1)) {
        const u = members[i]!,
          gate = await lockedExplorePair(db, this.accounts, u.id, v.id, 'RETRIEVAL');
        facts.push(gate.facts);
      }
    const result = allocate(members, facts, await loadVenues(db), now, seed),
      id = randomUUID(),
      policy = selected ? 'operator' : 'algorithm';
    const summary: Summary = {
      members: ids,
      unserved: [
        ...result.unserved,
        ...ids
          .filter((id) => !members.some((m) => m.id === id))
          .map((memberId) => ({ memberId, reason: 'zero eligible supply' })),
      ],
    };
    await db.query(
      'INSERT INTO app.explore_batches(id,seed,policy,creator_id,scheduled_week,summary_cipher) VALUES($1,$2,$3,$4,$5,$6)',
      [id, seed, policy, creator, scheduled, this.accounts.appCipher.seal(summary, `batch:${id}`)],
    );
    const batch = (await db.query<Batch>('SELECT * FROM app.explore_batches WHERE id=$1', [id]))
      .rows[0]!;
    for (const step of result.steps)
      await this.reserve(db, batch, step.edge.u, step.edge.v, step, policy);
    return { id };
  }
  async generate(auth: Authority, key: string, input: unknown, requestId: string) {
    const d = batchSchema.parse(input);
    return this.staff(auth, requestId, 'EXPLORE_GENERATED', (db) =>
      this.command(db, auth.memberId, key, { action: 'generate', d }, () =>
        this.generateIn(db, d.seed, d.members, auth.memberId, null),
      ),
    );
  }
  async generateScheduled() {
    return transaction(this.accounts.app, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(30,1)');
      const week = weekKey(await databaseNow(db));
      return this.generateIn(db, `weekly:${week}`, undefined, null, week);
    });
  }
  async batches(auth: Authority, requestId: string) {
    return this.staff(
      auth,
      requestId,
      'EXPLORE_REVIEW',
      async (db) =>
        (
          await db.query<{ id: string; status: string; version: number; created_at: Date }>(
            'SELECT id,status,version,created_at FROM app.explore_batches ORDER BY created_at DESC,id LIMIT $1',
            [pilot.EXPLORE_WORK_BATCH_SIZE],
          )
        ).rows,
    );
  }
  async review(auth: Authority, id: string, requestId: string) {
    return this.staff(auth, requestId, 'EXPLORE_REVIEW', async (db) => {
      const batch = (await db.query<Batch>('SELECT * FROM app.explore_batches WHERE id=$1', [id]))
        .rows[0];
      if (!batch) throw new StoreError('NOT_FOUND');
      const rows = (
        await db.query<Opportunity>(
          'SELECT * FROM app.opportunities WHERE batch_id=$1 ORDER BY low_id,high_id',
          [id],
        )
      ).rows;
      if (rows.some((o) => [o.low_id, o.high_id].includes(auth.memberId)))
        throw new StoreError('SELF_REVIEW');
      // A review holds several pairs until commit: take the union in global order
      // before visiting edges, or a worker on an overlapping edge can deadlock it.
      for (const member of [...new Set(rows.flatMap((o) => [o.low_id, o.high_id]))].sort())
        await db.query('SELECT app.lock_pair($1,$1)', [member]);
      const summary = this.accounts.appCipher.open<Summary>(batch.summary_cipher, `batch:${id}`);
      const pairs = [];
      for (const o of rows) {
        const gate = await lockedExplorePair(db, this.accounts, o.low_id, o.high_id, 'DELIVERY');
        pairs.push({
          id: o.id,
          state: o.state,
          version: o.version,
          lowId: o.low_id,
          highId: o.high_id,
          names: gate.allowed ? [gate.a!.profile.displayName, gate.b!.profile.displayName] : null,
          eligible: gate.allowed,
        });
      }
      const mail = (
        await db.query<{ state: string; count: number }>(
          "SELECT m.state,count(*)::int AS count FROM app.introduction_mail m JOIN app.opportunities o ON o.id=m.opportunity_id WHERE o.batch_id=$1 AND m.state IN ('UNCERTAIN','SENDING','FAILED') GROUP BY m.state",
          [id],
        )
      ).rows;
      return {
        id: batch.id,
        version: batch.version,
        status: batch.status,
        policy: batch.policy,
        pairs,
        unserved: summary.unserved,
        mail,
      };
    });
  }
  async edit(
    auth: Authority,
    id: string,
    key: string,
    input: {
      version: number;
      action: 'ADD' | 'REMOVE' | 'APPROVE';
      u?: string;
      v?: string;
      opportunityId?: string;
    },
    requestId: string,
  ) {
    return this.staff(
      auth,
      requestId,
      input.action === 'APPROVE' ? 'EXPLORE_APPROVED' : 'EXPLORE_EDITED',
      (db) =>
        this.command(db, auth.memberId, key, { action: 'batch', id, input }, async () => {
          const batch = (
            await db.query<Batch>('SELECT * FROM app.explore_batches WHERE id=$1 FOR UPDATE', [id])
          ).rows[0];
          if (!batch) throw new StoreError('NOT_FOUND');
          if (batch.version !== input.version || batch.status !== 'REVIEW')
            throw new StoreError('STALE_VERSION');
          const rows = (
            await db.query<Opportunity>(
              'SELECT * FROM app.opportunities WHERE batch_id=$1 ORDER BY low_id,high_id',
              [id],
            )
          ).rows;
          if (
            rows.some((o) => [o.low_id, o.high_id].includes(auth.memberId)) ||
            [input.u, input.v].includes(auth.memberId)
          )
            throw new StoreError('SELF_REVIEW');
          const involved = [
            ...rows.flatMap((o) => [o.low_id, o.high_id]),
            ...[input.u, input.v].filter((id): id is string => Boolean(id)),
          ];
          for (const member of [...new Set(involved)].sort())
            await db.query('SELECT app.lock_pair($1,$1)', [member]);
          if (input.action === 'ADD') {
            if (!input.u || !input.v) throw new StoreError('INVALID_INPUT');
            await this.reserve(db, batch, input.u, input.v, null, 'operator');
          } else if (input.action === 'REMOVE') {
            const target = rows.find((o) => o.id === input.opportunityId);
            if (!target) throw new StoreError('NOT_FOUND');
            await db.query('SELECT app.lock_pair($1,$2)', [target.low_id, target.high_id]);
            await db.query("SELECT app.close_opportunity($1,'CANCELLED')", [target.id]);
          } else {
            for (const o of rows.filter((o) => o.state === 'RESERVED')) {
              const gate = await lockedExplorePair(
                db,
                this.accounts,
                o.low_id,
                o.high_id,
                'DELIVERY',
              );
              if (!gate.allowed || gate.now >= o.reserve_expires_at) {
                await db.query("SELECT app.close_opportunity($1,'CANCELLED')", [o.id]);
                continue;
              }
              await db.query(
                'INSERT INTO app.introduction_outbox(opportunity_id) VALUES($1) ON CONFLICT DO NOTHING',
                [o.id],
              );
            }
          }
          if (input.action !== 'APPROVE') {
            await db.query(
              "UPDATE app.opportunities SET policy='operator',q=NULL WHERE batch_id=$1",
              [id],
            );
            await db.query("UPDATE app.explore_batches SET policy='operator' WHERE id=$1", [id]);
          }
          const changed = await db.query(
            "UPDATE app.explore_batches SET version=version+1,status=CASE WHEN $3 THEN 'APPROVED' ELSE status END WHERE id=$1 AND version=$2",
            [id, input.version, input.action === 'APPROVE'],
          );
          if (changed.rowCount !== 1) throw new StoreError('STALE_VERSION');
          return { id, version: input.version + 1 };
        }),
    );
  }
  async deliverOne(id: string) {
    return transaction(this.accounts.app, async (db) => {
      const o = await this.opportunity(db, id);
      const out = (
        await db.query<{ state: string }>(
          'SELECT state FROM app.introduction_outbox WHERE opportunity_id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!out || out.state !== 'PENDING' || o.state !== 'RESERVED') return { delivered: false };
      const gate = await lockedExplorePair(db, this.accounts, o.low_id, o.high_id, 'DELIVERY');
      if (!gate.allowed || gate.now >= o.reserve_expires_at) {
        await db.query("SELECT app.close_opportunity($1,'CANCELLED')", [id]);
        return { delivered: false };
      }
      const week = weekKey(gate.now),
        oldWeek = dateKey(o.reserved_week);
      for (const member of [o.low_id, o.high_id]) await ensureLedger(db, member, week);
      await db.query(
        'SELECT member_id FROM app.capacity_ledger WHERE member_id IN($1,$2) ORDER BY member_id FOR UPDATE',
        [o.low_id, o.high_id],
      );
      const budgets = (
        await db.query<{ member_id: string; delivered: number; pending: number }>(
          'SELECT * FROM app.exposure_week WHERE member_id IN($1,$2) AND week=$3 ORDER BY member_id FOR UPDATE',
          [o.low_id, o.high_id, week],
        )
      ).rows;
      if (
        budgets.some(
          (b) =>
            b.delivered + b.pending - (week === oldWeek ? 1 : 0) >= pilot.MAX_NEW_INTROS_PER_WEEK,
        )
      ) {
        await db.query("SELECT app.close_opportunity($1,'CANCELLED')", [id]);
        return { delivered: false };
      }
      await db.query(
        'UPDATE app.exposure_week SET pending=pending-1,version=version+1 WHERE member_id IN($1,$2) AND week=$3',
        [o.low_id, o.high_id, oldWeek],
      );
      await db.query(
        'UPDATE app.exposure_week SET delivered=delivered+1,version=version+1 WHERE member_id IN($1,$2) AND week=$3',
        [o.low_id, o.high_id, week],
      );
      const expiry = new Date(gate.now.getTime() + pilot.EXPLORE_RESPONSE_HOURS * 3600000);
      const changed = await db.query(
        "UPDATE app.opportunities SET state='PROPOSED',version=version+1,proposed_at=$3,expires_at=$4 WHERE id=$1 AND version=$2",
        [id, o.version, gate.now, expiry],
      );
      if (changed.rowCount !== 1) throw new StoreError('STALE_VERSION');
      await db.query(
        'UPDATE app.capacity_ledger SET last_offer_at=$3,version=version+1 WHERE member_id IN($1,$2)',
        [o.low_id, o.high_id, gate.now],
      );
      await db.query(
        'INSERT INTO app.profile_access(viewer_id,subject_id,expires_at) VALUES($1,$2,$3),($2,$1,$3) ON CONFLICT(viewer_id,subject_id) DO UPDATE SET expires_at=EXCLUDED.expires_at',
        [o.low_id, o.high_id, expiry],
      );
      await db.query('SELECT app.record_introduction_exposure($1)', [id]);
      await db.query(
        "UPDATE app.introduction_outbox SET state='DELIVERED' WHERE opportunity_id=$1",
        [id],
      );
      for (const member of [o.low_id, o.high_id])
        await db.query(
          "INSERT INTO app.introduction_mail(id,opportunity_id,member_id,kind) VALUES($1,$2,$3,'INTRODUCTION') ON CONFLICT DO NOTHING",
          [randomUUID(), id, member],
        );
      return { delivered: true };
    });
  }
  async deliverPending() {
    const pending = (
      await this.accounts.app.query<{ opportunity_id: string }>(
        "SELECT opportunity_id FROM app.introduction_outbox WHERE state='PENDING' ORDER BY created_at LIMIT $1",
        [pilot.EXPLORE_WORK_BATCH_SIZE],
      )
    ).rows;
    let failed = 0;
    for (const row of pending) {
      try {
        await this.deliverOne(row.opportunity_id);
      } catch {
        failed++;
      }
    }
    return { processed: pending.length, failed };
  }
  async own(auth: Authority) {
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) => {
        await db.query('SELECT app.lock_pair($1,$1)', [auth.memberId]);
        const now = await databaseNow(db);
        await ensureLedger(db, auth.memberId, weekKey(now));
        const ledger = (
          await db.query<{ held: number; cap_limit: number; version: number; reminders: boolean }>(
            'SELECT held,cap_limit,version,reminders FROM app.capacity_ledger WHERE member_id=$1',
            [auth.memberId],
          )
        ).rows[0]!;
        const rows = (
          await db.query<Opportunity & { decision: Decision; decision_version: number }>(
            `SELECT o.*,d.decision,d.version AS decision_version FROM app.opportunities o JOIN app.introduction_decisions d ON d.opportunity_id=o.id AND d.member_id=$1
    WHERE (o.low_id=$1 OR o.high_id=$1) AND o.proposed_at IS NOT NULL ORDER BY o.created_at DESC,o.id LIMIT $2`,
            [auth.memberId, pilot.EXPLORE_WORK_BATCH_SIZE],
          )
        ).rows;
        return {
          capacity: {
            held: ledger.held,
            limit: ledger.cap_limit,
            version: ledger.version,
            reminders: ledger.reminders,
          },
          opportunities: rows.map((o) => ({
            id: o.id,
            subjectId: o.low_id === auth.memberId ? o.high_id : o.low_id,
            status: memberStatus(
              o.state === 'PROPOSED' && o.expires_at! <= now ? 'EXPIRED' : o.state,
              o.decision,
            ),
            decision: o.decision,
            version: o.decision_version,
            expiresAt: o.expires_at,
          })),
        };
      }),
    );
  }
  async card(auth: Authority, id: string) {
    const row = (
      await this.accounts.app.query<Opportunity>(
        'SELECT * FROM app.opportunities WHERE id=$1 AND (low_id=$2 OR high_id=$2)',
        [id, auth.memberId],
      )
    ).rows[0];
    if (!row) throw new StoreError('NOT_FOUND');
    const subject = row.low_id === auth.memberId ? row.high_id : row.low_id;
    return withMemberPair(this.accounts, auth, subject, async (db) => {
      const o = (await db.query<Opportunity>('SELECT * FROM app.opportunities WHERE id=$1', [id]))
        .rows[0]!;
      if (!['PROPOSED', 'MUTUAL'].includes(o.state)) throw new StoreError('NOT_FOUND');
      if (o.state === 'PROPOSED') {
        const gate = await lockedExplorePair(db, this.accounts, o.low_id, o.high_id, 'ACCEPTANCE');
        if (!gate.allowed || gate.now >= o.expires_at!) throw new StoreError('NOT_FOUND');
      }
      const d = (
        await db.query<{ decision: Decision; version: number }>(
          'SELECT decision,version FROM app.introduction_decisions WHERE opportunity_id=$1 AND member_id=$2',
          [id, auth.memberId],
        )
      ).rows[0]!;
      return {
        id,
        subjectId: subject,
        status: memberStatus(o.state, d.decision),
        decision: d.decision,
        version: d.version,
        expiresAt: o.expires_at,
        profile: await approvedProfileFields(this.accounts, db, subject),
      };
    });
  }
  async decide(auth: Authority, id: string, key: string, input: unknown) {
    const d = decisionSchema.parse(input);
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) => {
        const o = await this.opportunity(db, id, auth.memberId);
        return this.command(db, auth.memberId, key, { action: 'decide', id, d }, async () => {
          const gate = await lockedExplorePair(
            db,
            this.accounts,
            o.low_id,
            o.high_id,
            'ACCEPTANCE',
          );
          const rows = (
            await db.query<{ member_id: string; decision: Decision; version: number }>(
              'SELECT member_id,decision,version FROM app.introduction_decisions WHERE opportunity_id=$1 ORDER BY member_id FOR UPDATE',
              [id],
            )
          ).rows;
          const own = rows.find((r) => r.member_id === auth.memberId)!,
            other = rows.find((r) => r.member_id !== auth.memberId)!;
          if (o.state !== 'PROPOSED') return { status: memberStatus(o.state, own.decision) };
          if (gate.now >= o.expires_at!) {
            await db.query("SELECT app.close_opportunity($1,'EXPIRED')", [id]);
            return { status: 'EXPIRED' };
          }
          if (!gate.allowed) {
            await db.query("SELECT app.close_opportunity($1,'CANCELLED')", [id]);
            return { status: 'UNAVAILABLE' };
          }
          if (own.version !== d.version || own.decision !== 'UNDECIDED')
            throw new StoreError('STALE_VERSION');
          const changed = await db.query(
            'UPDATE app.introduction_decisions SET decision=$3,version=version+1,decided_at=$4 WHERE opportunity_id=$1 AND member_id=$2 AND version=$5',
            [id, auth.memberId, d.decision, gate.now, d.version],
          );
          if (changed.rowCount !== 1) throw new StoreError('STALE_VERSION');
          await db.query('SELECT app.record_introduction_decision($1,$2)', [id, auth.memberId]);
          const state = decisionOutcome(
            o.state,
            o.expires_at!,
            gate.now,
            d.decision,
            other.decision,
          );
          if (state === 'PASSED') await db.query("SELECT app.close_opportunity($1,'PASSED')", [id]);
          else {
            const updated = await db.query(
              'UPDATE app.opportunities SET state=$3,version=version+1 WHERE id=$1 AND version=$2',
              [id, o.version, state],
            );
            if (updated.rowCount !== 1) throw new StoreError('STALE_VERSION');
            if (state === 'MUTUAL') {
              await db.query('INSERT INTO app.connections(id) VALUES($1) ON CONFLICT DO NOTHING', [
                id,
              ]);
              await db.query(
                "UPDATE app.profile_access SET expires_at='infinity' WHERE (viewer_id=$1 AND subject_id=$2) OR (viewer_id=$2 AND subject_id=$1)",
                [o.low_id, o.high_id],
              );
            }
          }
          return { status: memberStatus(state, d.decision) };
        });
      }),
    );
  }
  async close(auth: Authority, id: string, key: string) {
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) => {
        await this.opportunity(db, id, auth.memberId);
        return this.command(db, auth.memberId, key, { action: 'close', id }, async () => {
          await db.query("SELECT app.close_opportunity($1,'CLOSED')", [id]);
          return { closed: true };
        });
      }),
    );
  }
  async capacity(auth: Authority, key: string, input: unknown) {
    const d = capacitySchema.parse(input);
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) => {
        await db.query('SELECT app.lock_pair($1,$1)', [auth.memberId]);
        await ensureLedger(db, auth.memberId, weekKey(await databaseNow(db)));
        return this.command(db, auth.memberId, key, { action: 'capacity', d }, async () => {
          const r = await db.query(
            'UPDATE app.capacity_ledger SET cap_limit=$3,reminders=$4,version=version+1 WHERE member_id=$1 AND version=$2',
            [auth.memberId, d.version, d.limit, d.reminders],
          );
          if (r.rowCount !== 1) throw new StoreError('STALE_VERSION');
          return { version: d.version + 1 };
        });
      }),
    );
  }
  async expireOne(id: string) {
    return transaction(this.accounts.app, async (db) => {
      const o = await this.opportunity(db, id),
        now = await databaseNow(db);
      if (
        (o.state === 'RESERVED' && now >= o.reserve_expires_at) ||
        (o.state === 'PROPOSED' && now >= o.expires_at!)
      )
        await db.query("SELECT app.close_opportunity($1,'EXPIRED')", [id]);
    });
  }
  async maintain() {
    const rows = (
      await this.accounts.app.query<{ id: string }>(
        "SELECT id FROM app.opportunities WHERE (state='RESERVED' AND reserve_expires_at<=clock_timestamp()) OR (state='PROPOSED' AND expires_at<=clock_timestamp()) ORDER BY created_at LIMIT $1",
        [pilot.EXPLORE_WORK_BATCH_SIZE],
      )
    ).rows;
    for (const r of rows) await this.expireOne(r.id);
    // Reminder intent contains no profile/content. Sending still enters the pair gate.
    await this.accounts.app.query(
      `INSERT INTO app.introduction_mail(id,opportunity_id,member_id,kind)
   SELECT gen_random_uuid(),o.id,d.member_id,'REMINDER' FROM app.opportunities o
   JOIN app.introduction_decisions d ON d.opportunity_id=o.id AND d.decision='UNDECIDED'
   JOIN app.capacity_ledger c ON c.member_id=d.member_id AND c.reminders
   WHERE o.state='PROPOSED' AND o.expires_at>clock_timestamp() AND o.expires_at<=clock_timestamp()+$1*interval '1 hour' ON CONFLICT DO NOTHING`,
      [pilot.EXPLORE_REMINDER_HOURS],
    );
    await this.accounts.app.query(
      "UPDATE app.introduction_mail SET state='UNCERTAIN' WHERE state='SENDING' AND started_at<clock_timestamp()-$1*interval '1 minute'",
      [pilot.EXPLORE_MAIL_UNCERTAIN_MINUTES],
    );
    return { expired: rows.length };
  }
  /** Claim persists before external I/O. A crash/ambiguous SMTP result never
   * automatically retries a possibly sent product notification (DEC-042). */
  async sendOne(
    id: string,
    send: (email: string) => Promise<'SENT' | 'RETRY' | 'UNCERTAIN' | 'FAILED'>,
  ) {
    const claim = await transaction(this.accounts.app, async (db) => {
      const r = (
        await db.query<{ opportunity_id: string }>(
          'SELECT opportunity_id FROM app.introduction_mail WHERE id=$1',
          [id],
        )
      ).rows[0];
      if (!r) return false;
      const o = await this.opportunity(db, r.opportunity_id);
      const gate = await lockedExplorePair(db, this.accounts, o.low_id, o.high_id, 'DELIVERY');
      if (
        !gate.allowed ||
        !['PROPOSED', 'MUTUAL'].includes(o.state) ||
        (o.state === 'PROPOSED' && gate.now >= o.expires_at!)
      ) {
        await db.query(
          "UPDATE app.introduction_mail SET state='CANCELLED' WHERE id=$1 AND state='PENDING'",
          [id],
        );
        return false;
      }
      const changed = await db.query(
        "UPDATE app.introduction_mail SET state='SENDING',attempts=attempts+1,started_at=clock_timestamp() WHERE id=$1 AND state='PENDING' AND next_attempt_at<=clock_timestamp() AND attempts<$2",
        [id, pilot.EXPLORE_MAIL_MAX_ATTEMPTS],
      );
      return changed.rowCount === 1;
    });
    if (!claim) return;
    await transaction(this.accounts.app, async (db) => {
      const mail = (
        await db.query<{
          opportunity_id: string;
          member_id: string;
          kind: string;
          attempts: number;
        }>('SELECT opportunity_id,member_id,kind,attempts FROM app.introduction_mail WHERE id=$1', [
          id,
        ])
      ).rows[0]!;
      const o = await this.opportunity(db, mail.opportunity_id);
      const gate = await lockedExplorePair(db, this.accounts, o.low_id, o.high_id, 'DELIVERY');
      const row = (
        await db.query<{ state: string }>(
          'SELECT state FROM app.introduction_mail WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0]!;
      if (row.state !== 'SENDING') return;
      const reminder = (
        await db.query<{ reminders: boolean; decision: Decision }>(
          'SELECT c.reminders,d.decision FROM app.capacity_ledger c JOIN app.introduction_decisions d ON d.member_id=c.member_id WHERE c.member_id=$1 AND d.opportunity_id=$2',
          [mail.member_id, o.id],
        )
      ).rows[0];
      if (
        !gate.allowed ||
        !['PROPOSED', 'MUTUAL'].includes(o.state) ||
        (o.state === 'PROPOSED' && gate.now >= o.expires_at!) ||
        (mail.kind === 'REMINDER' && (!reminder?.reminders || reminder.decision !== 'UNDECIDED'))
      ) {
        await db.query("UPDATE app.introduction_mail SET state='CANCELLED' WHERE id=$1", [id]);
        return;
      }
      const identity = (
        await this.accounts.identity.query<{ email_cipher: string }>(
          'SELECT email_cipher FROM identity.users WHERE id=$1',
          [mail.member_id],
        )
      ).rows[0];
      if (!identity) {
        await db.query("UPDATE app.introduction_mail SET state='FAILED' WHERE id=$1", [id]);
        return;
      }
      let outcome: 'SENT' | 'RETRY' | 'UNCERTAIN' | 'FAILED';
      try {
        outcome = await send(
          this.accounts.identityCipher.open<string>(
            identity.email_cipher,
            `email:${mail.member_id}`,
          ),
        );
      } catch {
        outcome = 'UNCERTAIN';
      }
      const state =
        outcome === 'RETRY'
          ? mail.attempts >= pilot.EXPLORE_MAIL_MAX_ATTEMPTS
            ? 'FAILED'
            : 'PENDING'
          : outcome;
      await db.query(
        "UPDATE app.introduction_mail SET state=$2,next_attempt_at=clock_timestamp()+$3*interval '1 second',sent_at=CASE WHEN $2='SENT' THEN clock_timestamp() ELSE NULL END WHERE id=$1",
        [id, state, pilot.EXPLORE_MAIL_RETRY_SECONDS],
      );
    });
  }
  async sendNotifications(
    send: (email: string) => Promise<'SENT' | 'RETRY' | 'UNCERTAIN' | 'FAILED'>,
  ) {
    const rows = (
      await this.accounts.app.query<{ id: string }>(
        "SELECT id FROM app.introduction_mail WHERE state='PENDING' AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,id LIMIT $1",
        [pilot.EXPLORE_WORK_BATCH_SIZE],
      )
    ).rows;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.sendOne(row.id, send);
      } catch {
        failed++;
      }
    }
    return { processed: rows.length, failed };
  }
}
