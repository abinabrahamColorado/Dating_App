import { z } from 'zod';
import type { PoolClient } from 'pg';
import { lifecycleConfig as config } from '@meetwell/config/lifecycle';
import { pilot } from '@meetwell/config/pilot';
import {
  feedbackSchema,
  feedbackDue,
  attendance,
  exitSchema,
  followupSchema,
  type Feedback,
} from '@meetwell/core/feedback';
import { AccountStore, StoreError, transaction, type Authority } from './accounts';
import { ConnectionStore } from './connections';
import { lockedConnection } from './connection-policy';

type Encounter = {
  id: string;
  connection_id: string;
  low_id: string;
  high_id: string;
  start_at: Date;
  timezone: string;
  eligible: boolean;
};
/** Own encounter answers only. Nothing returned contains the other person's
 * response, chips, response time or presence. No current profile is disclosed. */
export class FeedbackStore {
  constructor(readonly accounts: AccountStore) {}
  private async command<T>(
    db: PoolClient,
    actor: string,
    key: string,
    payload: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const hash = this.accounts.lookup(JSON.stringify(payload));
    const prior = (
      await db.query(
        'SELECT request_hash,result_cipher FROM app.command_receipts WHERE member_id=$1 AND command_key=$2',
        [actor, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw new StoreError('IDEMPOTENCY_CONFLICT');
      return this.accounts.appCipher.open<T>(prior.result_cipher, `receipt:${actor}:${key}`);
    }
    const result = await run();
    await db.query(
      'INSERT INTO app.command_receipts(member_id,command_key,request_hash,result_cipher) VALUES($1,$2,$3,$4)',
      [actor, key, hash, this.accounts.appCipher.seal(result, `receipt:${actor}:${key}`)],
    );
    return result;
  }
  async maintain() {
    return transaction(this.accounts.app, async (db) => {
      const rows = (
        await db.query<Encounter>(
          `SELECT e.* FROM app.encounters e WHERE e.eligible
        AND NOT EXISTS(SELECT 1 FROM app.feedback_prompts p WHERE p.encounter_id=e.id)
        ORDER BY e.start_at,e.id LIMIT $1 FOR UPDATE OF e SKIP LOCKED`,
          [config.WORK_BATCH_SIZE],
        )
      ).rows;
      for (const e of rows) {
        const due = feedbackDue(e.start_at, e.timezone);
        for (const actor of [e.low_id, e.high_id])
          await db.query('SELECT app.record_feedback_prompt($1,$2,$3)', [e.id, actor, due]);
      }
      return rows.length;
    });
  }
  async list(auth: Authority) {
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) => {
        const rows = (
          await db.query<
            Encounter & {
              due_at: Date;
              presented_at: Date | null;
              dismissed_at: Date | null;
              body_cipher: string | null;
            }
          >(
            `SELECT e.*,p.due_at,p.presented_at,p.dismissed_at,f.body_cipher FROM app.feedback_prompts p
         JOIN app.encounters e ON e.id=p.encounter_id LEFT JOIN app.matching_feedback f ON f.encounter_id=e.id AND f.member_id=p.member_id
         WHERE p.member_id=$1 AND e.eligible AND p.due_at<=clock_timestamp()
         ORDER BY p.due_at DESC,e.id LIMIT $2`,
            [auth.memberId, config.PAGE_SIZE],
          )
        ).rows;
        return rows.map((r) => ({
          id: r.id,
          connectionId: r.connection_id,
          subjectId: r.low_id === auth.memberId ? r.high_id : r.low_id,
          plannedAt: r.start_at,
          dueAt: r.due_at,
          presented: !!r.presented_at,
          dismissed: !!r.dismissed_at,
          answer: r.body_cipher
            ? this.accounts.appCipher.open<Feedback>(
                r.body_cipher,
                `feedback:${r.id}:${auth.memberId}`,
              )
            : null,
        }));
      }),
    );
  }
  async present(auth: Authority, id: string, key: string, dismiss: boolean) {
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) =>
        this.command(
          db,
          auth.memberId,
          key,
          { action: 'feedback-present', id, dismiss },
          async () => {
            const row = await db.query(
              `UPDATE app.feedback_prompts p SET presented_at=coalesce(presented_at,clock_timestamp()),
        dismissed_at=CASE WHEN $3 THEN coalesce(dismissed_at,clock_timestamp()) ELSE dismissed_at END
        FROM app.encounters e WHERE p.encounter_id=e.id AND e.eligible AND p.encounter_id=$1 AND p.member_id=$2 AND p.due_at<=clock_timestamp() RETURNING p.encounter_id`,
              [id, auth.memberId, dismiss],
            );
            if (!row.rowCount) throw new StoreError('NOT_FOUND');
            return { saved: true };
          },
        ),
      ),
    );
  }
  async answer(auth: Authority, id: string, key: string, input: unknown) {
    const data = feedbackSchema.parse(input);
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) => {
        const e = (
          await db.query<Encounter>(
            'SELECT * FROM app.encounters WHERE id=$1 AND $2 IN(low_id,high_id) AND eligible FOR UPDATE',
            [id, auth.memberId],
          )
        ).rows[0];
        if (!e) throw new StoreError('NOT_FOUND');
        return this.command(db, auth.memberId, key, { action: 'feedback', id, data }, async () => {
          const prompt = (
            await db.query(
              'SELECT 1 FROM app.feedback_prompts WHERE encounter_id=$1 AND member_id=$2 AND due_at<=clock_timestamp()',
              [id, auth.memberId],
            )
          ).rowCount;
          if (!prompt) throw new StoreError('NOT_FOUND');
          const inserted = await db.query(
            'INSERT INTO app.matching_feedback(encounter_id,member_id,body_cipher) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING member_id',
            [
              id,
              auth.memberId,
              this.accounts.appCipher.seal(data, `feedback:${id}:${auth.memberId}`),
            ],
          );
          if (!inserted.rowCount) throw new StoreError('STALE_VERSION');
          const other = e.low_id === auth.memberId ? e.high_id : e.low_id;
          const prior = (
            await db.query(
              'SELECT body_cipher FROM app.matching_feedback WHERE encounter_id=$1 AND member_id=$2',
              [id, other],
            )
          ).rows[0];
          const counterpart = prior
            ? this.accounts.appCipher.open<Feedback>(prior.body_cipher, `feedback:${id}:${other}`)
            : null;
          const provenance = attendance(data.met, counterpart?.met ?? null);
          await db.query('SELECT app.record_experience($1,$2,$3,$4,$5,$6,$7)', [
            id,
            auth.memberId,
            data.met,
            data.again,
            data.chips,
            provenance.provenance,
            provenance.attended,
          ]);
          await db.query(
            'UPDATE app.feedback_prompts SET presented_at=coalesce(presented_at,clock_timestamp()) WHERE encounter_id=$1 AND member_id=$2',
            [id, auth.memberId],
          );
          return { saved: true }; // Never return aggregate attendance or a mutual Yes.
        });
      }),
    );
  }
  /** Explicit communication action, wholly independent of private feedback. The
   * existing send and delivery paths both recheck isDenied under app.lock_pair. */
  async invite(auth: Authority, connection: string, key: string) {
    return new ConnectionStore(this.accounts).send(auth, connection, key, {
      text: 'Would you like to meet again?',
    });
  }
  async secondMeeting(auth: Authority, connection: string, key: string, input: unknown) {
    const data = z.object({ metAgain: z.boolean() }).strict().parse(input);
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) => {
        const { connection: c } = await lockedConnection(db, connection, auth.memberId);
        // Self-report remains private after closure. No partner answer is read or sent.
        if (![c.low_id, c.high_id].includes(auth.memberId)) throw new StoreError('NOT_FOUND');
        return this.command(
          db,
          auth.memberId,
          key,
          { action: 'second-meeting', connection, data },
          async () => {
            const r = await db.query(
              'INSERT INTO app.second_meeting_reports(connection_id,member_id,met_again) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING member_id',
              [connection, auth.memberId, data.metAgain],
            );
            if (!r.rowCount) throw new StoreError('STALE_VERSION');
            return { saved: true };
          },
        );
      }),
    );
  }
  async exit(auth: Authority, key: string, input: unknown) {
    const d = exitSchema.parse(input);
    return this.accounts.withSession(auth, () =>
      this.accounts.changePolicy(
        auth,
        key,
        {
          action: 'EXIT',
          version: d.version,
          ...(d.meaningfulConnection
            ? { exitReason: 'met-someone-here' as const }
            : d.exitReason
              ? { exitReason: d.exitReason }
              : {}),
        },
        async (db) => {
          await db.query(
            'INSERT INTO app.success_exits(member_id,meaningful) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [auth.memberId, d.meaningfulConnection],
          );
          for (const day of pilot.FOLLOWUP_DAYS)
            if (day === 30 ? d.followup30 : d.followup90)
              await db.query(
                `INSERT INTO app.outcome_followups(member_id,day,due_at) VALUES($1,$2,clock_timestamp()+$2*interval '1 day') ON CONFLICT DO NOTHING`,
                [auth.memberId, day],
              );
        },
        d,
      ),
    );
  }
  async followups(auth: Authority) {
    return this.accounts.withSession(auth, async () => {
      const rows = (
        await this.accounts.app.query(
          'SELECT day,due_at,revoked_at,presented_at,answer FROM app.outcome_followups WHERE member_id=$1 ORDER BY day',
          [auth.memberId],
        )
      ).rows;
      return rows.map((r) => ({
        day: r.day,
        dueAt: r.due_at,
        revoked: !!r.revoked_at,
        presented: !!r.presented_at,
        answer: r.answer ?? 'UNKNOWN',
      }));
    });
  }
  async followup(auth: Authority, day: number, key: string, input: unknown) {
    const d = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('ANSWER'), ...followupSchema.shape }).strict(),
        z.object({ action: z.enum(['PRESENT', 'REVOKE']) }).strict(),
      ])
      .parse(input);
    if (!(pilot.FOLLOWUP_DAYS as readonly number[]).includes(day))
      throw new StoreError('INVALID_INPUT');
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) =>
        this.command(db, auth.memberId, key, { action: 'followup', day, d }, async () => {
          const r = await db.query(
            `UPDATE app.outcome_followups SET
        revoked_at=CASE WHEN $3='REVOKE' THEN coalesce(revoked_at,clock_timestamp()) ELSE revoked_at END,
        presented_at=CASE WHEN $3<>'REVOKE' THEN coalesce(presented_at,clock_timestamp()) ELSE presented_at END,
        answer=CASE WHEN $3='ANSWER' THEN $4 ELSE answer END,
        answered_at=CASE WHEN $3='ANSWER' THEN clock_timestamp() ELSE answered_at END
        WHERE member_id=$1 AND day=$2 AND ($3='REVOKE' OR (revoked_at IS NULL AND due_at<=clock_timestamp() AND answer IS NULL)) RETURNING day`,
            [auth.memberId, day, d.action, d.action === 'ANSWER' ? d.answer : null],
          );
          if (!r.rowCount) throw new StoreError('NOT_FOUND');
          return { saved: true };
        }),
      ),
    );
  }
  async attention(auth: Authority, key: string, input: unknown) {
    const d = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('CONSENT'), enabled: z.boolean() }).strict(),
        z
          .object({
            action: z.literal('RECORD'),
            seconds: z.number().int().min(1).max(config.ATTENTION_MAX_SECONDS),
          })
          .strict(),
      ])
      .parse(input);
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) =>
        this.command(db, auth.memberId, key, { action: 'attention', d }, async () => {
          if (d.action === 'CONSENT')
            await db.query(
              `INSERT INTO app.attention_consent(member_id,enabled) VALUES($1,$2) ON CONFLICT(member_id) DO UPDATE SET enabled=excluded.enabled,updated_at=clock_timestamp()`,
              [auth.memberId, d.enabled],
            );
          else
            await db.query(
              `INSERT INTO app.attention_minutes(member_id,minute,seconds) SELECT $1,date_trunc('minute',clock_timestamp()),$2
        WHERE EXISTS(SELECT 1 FROM app.attention_consent WHERE member_id=$1 AND enabled) ON CONFLICT DO NOTHING`,
              [auth.memberId, d.seconds],
            );
          return { saved: true };
        }),
      ),
    );
  }
  async attentionConsent(auth: Authority) {
    return this.accounts.withSession(auth, async () => ({
      enabled:
        (
          await this.accounts.app.query(
            'SELECT enabled FROM app.attention_consent WHERE member_id=$1',
            [auth.memberId],
          )
        ).rows[0]?.enabled ?? false,
    }));
  }
}
