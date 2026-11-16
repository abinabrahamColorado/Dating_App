import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { pilot, retention } from '@meetwell/config/pilot';
import { lifecycleConfig } from '@meetwell/config/lifecycle';
import { publicMetrics, safeCells, type MetricInput } from '@meetwell/core/metrics';
import { AccountStore, StoreError, type Authority } from './accounts';
import { lifecycleTransaction } from './lifecycle';
import { readinessSchema, readinessExpiry, type Readiness } from '@meetwell/core/readiness';
export class MetricStore {
  constructor(readonly accounts: AccountStore) {}
  async readiness(auth: Authority, requestId: string) {
    return this.accounts.withSession(auth, () =>
      this.accounts.withStaff(auth.memberId, ['admin'], async (db) => {
        await db.query(
          "INSERT INTO ops.audit(id,actor_id,action,request_id) VALUES($1,$2,'PRIVACY_REVIEW',$3)",
          [randomUUID(), auth.memberId, requestId],
        );
        const rows = (
          await db.query<{
            gate: string;
            version: number;
            passed: boolean;
            evidence_cipher: string;
            expires_at: Date;
          }>(
            'SELECT gate,version,passed,evidence_cipher,expires_at FROM ops.readiness_reviews ORDER BY gate',
          )
        ).rows;
        return rows.map(({ evidence_cipher, ...r }) => ({
          ...r,
          evidence: this.accounts.appCipher.open<string>(evidence_cipher, `readiness:${r.gate}`),
        }));
      }),
    );
  }
  async review(auth: Authority, key: string, input: unknown, requestId: string) {
    const d = readinessSchema.parse(input);
    return this.accounts.withSession(auth, () =>
      this.accounts.withStaff(auth.memberId, ['admin'], async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(55,3)');
        const hash = this.accounts.lookup(JSON.stringify(d)),
          old = (
            await db.query(
              'SELECT version,command_key,request_hash FROM ops.readiness_reviews WHERE gate=$1 FOR UPDATE',
              [d.gate],
            )
          ).rows[0];
        if (old?.command_key === key) {
          if (old.request_hash !== hash) throw new StoreError('IDEMPOTENCY_CONFLICT');
          return { saved: true };
        }
        if ((old?.version ?? 0) !== d.version) throw new StoreError('STALE_VERSION');
        const now = (await db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
        await db.query(
          `INSERT INTO ops.readiness_reviews(gate,version,passed,evidence_cipher,actor_id,command_key,request_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(gate) DO UPDATE SET version=excluded.version,passed=excluded.passed,evidence_cipher=excluded.evidence_cipher,actor_id=excluded.actor_id,command_key=excluded.command_key,request_hash=excluded.request_hash,reviewed_at=clock_timestamp(),expires_at=excluded.expires_at`,
          [
            d.gate,
            d.version + 1,
            d.passed,
            this.accounts.appCipher.seal(d.evidence, `readiness:${d.gate}`),
            auth.memberId,
            key,
            hash,
            readinessExpiry(now),
          ],
        );
        await db.query(
          "INSERT INTO ops.audit(id,actor_id,action,request_id) VALUES($1,$2,'PRIVACY_REVIEW',$3)",
          [randomUUID(), auth.memberId, requestId],
        );
        return { saved: true };
      }),
    );
  }
  async list(auth: Authority, requestId: string) {
    return this.accounts.withSession(auth, () =>
      this.accounts.withStaff(auth.memberId, ['operator'], async (db) => {
        await db.query(
          "INSERT INTO ops.audit(id,actor_id,action,request_id) VALUES($1,$2,'METRICS_READ',$3)",
          [randomUUID(), auth.memberId, requestId],
        );
        const rows = (
          await db.query(
            'SELECT c.id,c.started_at,c.policy_version,s.body,s.updated_at FROM ops.metric_cohorts c LEFT JOIN ops.metric_snapshots s ON s.cohort_id=c.id ORDER BY c.started_at DESC LIMIT $1',
            [lifecycleConfig.PAGE_SIZE],
          )
        ).rows;
        return rows;
      }),
    );
  }
  async freeze(auth: Authority, key: string, requestId: string) {
    return this.accounts.withSession(auth, () =>
      this.accounts.withStaff(auth.memberId, ['operator'], async (db) => {
        await db.query('SELECT ops.freeze_metric_cohort($1,$2,$3,$4)', [
          key,
          auth.memberId,
          'M5-fixed-cohort-v1',
          JSON.stringify(pilot),
        ]);
        await db.query(
          "INSERT INTO ops.audit(id,actor_id,action,subject_id,request_id) VALUES($1,$2,'COHORT_FROZEN',$3,$4)",
          [randomUUID(), auth.memberId, key, requestId],
        );
        return { id: key };
      }),
    );
  }
}
export async function refreshMetrics(pool: Pool, accounts: AccountStore) {
  return lifecycleTransaction(pool, async (db) => {
    const cohorts = (
      await db.query<{
        id: string;
        started_at: Date;
        denominator: number;
        thresholds: typeof pilot;
      }>('SELECT id,started_at,denominator,thresholds FROM ops.metric_cohorts')
    ).rows;
    const now = (await db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    const reviews: Readiness = Object.fromEntries(
      (
        await db.query<{ gate: string; passed: boolean; expires_at: Date }>(
          'SELECT gate,passed,expires_at FROM ops.readiness_reviews',
        )
      ).rows.map((r) => [r.gate, { passed: r.passed, expiresAt: r.expires_at.toISOString() }]),
    );
    const queues = (await db.query('SELECT ops.queue_counts($1) AS data', [JSON.stringify(pilot)]))
      .rows[0]!.data as Record<string, number | null>;
    const queueCells = Object.entries(queues)
      .filter(([k]) => k !== 'urgentOldestHours')
      .map(([, v]) => v ?? 0);
    const total =
      (queues.reportsOpen ?? 0) +
      (queues.integrityOpen ?? 0) +
      (queues.appealsOpen ?? 0) +
      (queues.deletionsRequested ?? 0) +
      (queues.photoQueue ?? 0);
    const operations =
      total >= pilot.SMALL_CELL_MIN_MEMBERS &&
      safeCells([
        ...queueCells,
        (queues.appealsDecided ?? 0) - (queues.appealsLifted ?? 0),
        (queues.deletionsRequested ?? 0) - (queues.deletionsCompleted ?? 0),
      ])
        ? {
            ...queues,
            denominator: total,
            completeness: { both: 0, one: total, neither: 0, contradictory: 0 },
            observation:
              'Retained operational records, not unique people or corroborated incidents. Appeals lifted / decided; deletion completed / requested. Urgent age uses open urgent reports.',
          }
        : null;
    for (const c of cohorts) {
      const raw = (
        await db.query('SELECT ops.metric_input($1,$2) AS data', [c.id, JSON.stringify(retention)])
      ).rows[0]!.data as Omit<MetricInput, 'asOf' | 'startedAt' | 'denominator' | 'members'> & {
        members: (MetricInput['members'][number] & { state: string; intent: string })[];
        batches: { id: string; summary_cipher: string }[];
      };
      const reasons = new Map<string, string>();
      for (const b of raw.batches) {
        const summary = accounts.appCipher.open<{
          unserved: { memberId: string; reason: string }[];
        }>(b.summary_cipher, `batch:${b.id}`);
        for (const u of summary.unserved) reasons.set(u.memberId, u.reason);
      }
      const input: MetricInput = {
        ...raw,
        denominator: c.denominator,
        startedAt: c.started_at.toISOString(),
        asOf: now.toISOString(),
        members: raw.members.map((m) => ({
          ...m,
          unservedReason:
            m.state === 'PAUSED' || m.intent === 'FOCUS'
              ? 'user pause or focus'
              : (reasons.get(m.id) ?? 'not assessed'),
        })),
      };
      const body = { ...publicMetrics(input, c.thresholds, reviews), operations };
      await db.query(
        'INSERT INTO ops.metric_snapshots(cohort_id,body) VALUES($1,$2) ON CONFLICT(cohort_id) DO UPDATE SET body=excluded.body,updated_at=clock_timestamp()',
        [c.id, JSON.stringify(body)],
      );
    }
    return cohorts.length;
  });
}
