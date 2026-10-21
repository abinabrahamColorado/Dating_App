import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { safetyConfig as c } from '@meetwell/config/safety';
import {
  reportSchema,
  integritySchema,
  caseCommandSchema,
  enforcementSchema,
  appealSchema,
  appealDecisionSchema,
  switchSchema,
  precautionAllowed,
  canDecideAppeal,
  restrictionNotice,
} from '@meetwell/core/safety';
import { AccountStore, StoreError, transaction, type Authority } from './accounts';
import { Envelope } from './encryption';

type CaseRow = {
  id: string;
  reporter_id: string;
  subject_id: string | null;
  detail_cipher: string;
  context_cipher: string;
  severity: string;
  status: string;
  version: number;
  created_at: Date;
};
type Enforcement = {
  member_id: string;
  restricted: boolean;
  version: number;
  case_id: string | null;
  issued_by: string | null;
};
/** Only the safety service receives this pool/key. Serving imports member-access,
 * never this class to make a profile eligibility decision. */
export class SafetyStore {
  private readonly cipher: Envelope;
  constructor(
    readonly accounts: AccountStore,
    readonly pool: Pool,
    key: string,
  ) {
    this.cipher = new Envelope(key);
  }
  private async audit(
    db: PoolClient,
    actor: string,
    record: string | null,
    action: string,
    requestId: string,
  ) {
    await db.query(
      'INSERT INTO safety.case_access_audit(id,actor_id,record_id,action,request_id) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), actor, record, action, requestId],
    );
  }
  private async member<T>(auth: Authority, run: (db: PoolClient) => Promise<T>) {
    return this.accounts.withSession(auth, () => transaction(this.pool, run));
  }
  private async staff<T>(auth: Authority, run: (db: PoolClient) => Promise<T>) {
    return this.accounts.withSession(auth, () =>
      this.accounts.withStaff(auth.memberId, ['safety_reviewer'], () =>
        transaction(this.pool, run),
      ),
    );
  }
  private async command<T>(
    db: PoolClient,
    auth: Authority,
    key: string,
    input: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,20))', [auth.memberId]);
    const hash = this.accounts.lookup(JSON.stringify(input));
    const old = await db.query<{ request_hash: string; result_cipher: string }>(
      'SELECT request_hash,result_cipher FROM safety.command_receipts WHERE actor_id=$1 AND command_key=$2',
      [auth.memberId, key],
    );
    if (old.rows[0]) {
      if (old.rows[0].request_hash !== hash) throw new StoreError('IDEMPOTENCY_CONFLICT');
      return this.cipher.open<T>(
        old.rows[0].result_cipher,
        `safety-receipt:${auth.memberId}:${key}`,
      );
    }
    const result = await run();
    await db.query(
      'INSERT INTO safety.command_receipts(actor_id,command_key,request_hash,result_cipher) VALUES($1,$2,$3,$4)',
      [
        auth.memberId,
        key,
        hash,
        this.cipher.seal(result, `safety-receipt:${auth.memberId}:${key}`),
      ],
    );
    return result;
  }
  async report(auth: Authority, key: string, input: unknown, requestId: string, integrity = false) {
    const data = integrity ? integritySchema.parse(input) : reportSchema.parse(input);
    if (data.subjectId === auth.memberId) throw new StoreError('INVALID_INPUT');
    return this.member(auth, (db) =>
      this.command(
        db,
        auth,
        key,
        { action: integrity ? 'integrity' : 'report', data },
        async () => {
          const id = randomUUID();
          // No FK to account/profile and no isDenied gate: reporting survives blocks/deletion.
          if (integrity)
            await db.query(
              'INSERT INTO safety.integrity_signal(id,reporter_id,subject_id,detail_cipher,context_cipher) VALUES($1,$2,$3,$4,$5)',
              [
                id,
                auth.memberId,
                data.subjectId,
                this.cipher.seal(data.detail, `detail:${id}`),
                this.cipher.seal(data.context, `context:${id}`),
              ],
            );
          else {
            await db.query(
              'INSERT INTO safety.report(id,reporter_id,subject_id,detail_cipher,context_cipher,severity) VALUES($1,$2,$3,$4,$5,$6)',
              [
                id,
                auth.memberId,
                data.subjectId,
                this.cipher.seal(data.detail, `detail:${id}`),
                this.cipher.seal(data.context, `context:${id}`),
                'severity' in data ? data.severity : 'STANDARD',
              ],
            );
            await db.query(
              "INSERT INTO safety.safety_signal(id,report_id,kind) VALUES($1,$2,'MEMBER_REPORT')",
              [randomUUID(), id],
            );
          }
          await this.audit(
            db,
            auth.memberId,
            id,
            integrity ? 'INTEGRITY_RECEIVED' : 'REPORT_RECEIVED',
            requestId,
          );
          return {
            id,
            status: 'RECEIVED',
            kind: integrity ? 'integrity' : 'report',
            message: 'Received. You can check its status here. No block was added by this report.',
          };
        },
      ),
    );
  }
  async ownCases(auth: Authority, requestId: string) {
    return this.member(auth, async (db) => {
      const rows = await db.query<{ id: string; status: string; created_at: Date; kind: string }>(
        `SELECT id,status,created_at,'report' AS kind FROM safety.report WHERE reporter_id=$1
        UNION ALL SELECT id,status,created_at,'integrity' AS kind FROM safety.integrity_signal WHERE reporter_id=$1 ORDER BY created_at DESC,id DESC`,
        [auth.memberId],
      );
      for (const row of rows.rows)
        await this.audit(db, auth.memberId, row.id, 'MEMBER_STATUS_READ', requestId);
      return rows.rows;
    });
  }
  async ownCase(auth: Authority, id: string, requestId: string) {
    return this.member(auth, async (db) => {
      const row = await db.query(
        `SELECT id,status,created_at,'report' AS kind FROM safety.report WHERE id=$1 AND reporter_id=$2
        UNION ALL SELECT id,status,created_at,'integrity' AS kind FROM safety.integrity_signal WHERE id=$1 AND reporter_id=$2`,
        [id, auth.memberId],
      );
      if (!row.rows[0]) throw new StoreError('NOT_FOUND');
      await this.audit(db, auth.memberId, id, 'MEMBER_STATUS_READ', requestId);
      return row.rows[0] as { id: string; status: string; created_at: Date; kind: string };
    });
  }
  async queue(auth: Authority, kind: 'report' | 'integrity', requestId: string, page: number) {
    return this.staff(auth, async (db) => {
      const table = kind === 'report' ? 'report' : 'integrity_signal';
      const severity = kind === 'report' ? 'severity' : "'STANDARD'::text AS severity";
      const order =
        kind === 'report'
          ? "CASE severity WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,"
          : '';
      const rows = await db.query<
        Pick<CaseRow, 'id' | 'severity' | 'status' | 'version' | 'created_at'>
      >(
        `SELECT id,${severity},status,version,created_at FROM safety.${table} WHERE status<>'CLOSED' ORDER BY ${order} created_at,id LIMIT $1 OFFSET $2`,
        [c.CASE_PAGE_SIZE, page * c.CASE_PAGE_SIZE],
      );
      for (const row of rows.rows)
        await this.audit(db, auth.memberId, row.id, `${kind.toUpperCase()}_QUEUE_VIEW`, requestId);
      return rows.rows;
    });
  }
  async view(auth: Authority, id: string, kind: 'report' | 'integrity', requestId: string) {
    return this.staff(auth, async (db) => {
      const table = kind === 'report' ? 'report' : 'integrity_signal';
      const row = (await db.query<CaseRow>(`SELECT * FROM safety.${table} WHERE id=$1`, [id]))
        .rows[0];
      if (!row) throw new StoreError('NOT_FOUND');
      await this.audit(db, auth.memberId, id, `${kind.toUpperCase()}_CASE_VIEW`, requestId);
      const enforcement = row.subject_id
        ? (
            await db.query<Enforcement>(
              'SELECT member_id,restricted,version FROM safety.enforcement WHERE member_id=$1',
              [row.subject_id],
            )
          ).rows[0]
        : null;
      // Reporter ID is deliberately absent even from routine case triage DTOs.
      return {
        id,
        subjectId: row.subject_id,
        detail: this.cipher.open<string>(row.detail_cipher, `detail:${id}`),
        context: this.cipher.open(row.context_cipher, `context:${id}`),
        severity: row.severity ?? 'STANDARD',
        status: row.status,
        version: row.version,
        createdAt: row.created_at,
        enforcement: enforcement ?? { restricted: false, version: 0 },
      };
    });
  }
  async updateCase(
    auth: Authority,
    id: string,
    kind: 'report' | 'integrity',
    key: string,
    input: unknown,
    requestId: string,
  ) {
    const data = caseCommandSchema.parse(input);
    return this.staff(auth, (db) =>
      this.command(db, auth, key, { action: 'case', id, kind, data }, async () => {
        const r =
          kind === 'report'
            ? await db.query(
                "UPDATE safety.report SET status=$3,severity=$4,version=version+1,closed_at=CASE WHEN $3='CLOSED' THEN now() ELSE NULL END WHERE id=$1 AND version=$2 RETURNING version",
                [id, data.version, data.status, data.severity],
              )
            : await db.query(
                'UPDATE safety.integrity_signal SET status=$3,version=version+1 WHERE id=$1 AND version=$2 RETURNING version',
                [id, data.version, data.status],
              );
        if (!r.rowCount) throw new StoreError('STALE_VERSION');
        await this.audit(db, auth.memberId, id, `${kind.toUpperCase()}_UPDATED`, requestId);
        return { version: data.version + 1 };
      }),
    );
  }
  private async setRestriction(
    db: PoolClient,
    auth: Authority,
    subject: string,
    version: number,
    restricted: boolean,
    caseId: string | null,
    requestId: string,
  ) {
    if (!precautionAllowed(auth.memberId, subject)) throw new StoreError('FORBIDDEN');
    await db.query('SELECT app.lock_pair($1,$1)', [subject]);
    // Also serializes enforcement of a tombstoned/nonexistent subject (no account FK).
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,21))', [subject]);
    const row = (
      await db.query<Enforcement>(
        'SELECT * FROM safety.enforcement WHERE member_id=$1 FOR UPDATE',
        [subject],
      )
    ).rows[0];
    if ((row?.version ?? 0) !== version) throw new StoreError('STALE_VERSION');
    await db.query(
      'INSERT INTO safety.enforcement(member_id,restricted,version,case_id,issued_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(member_id) DO UPDATE SET restricted=EXCLUDED.restricted,version=EXCLUDED.version,case_id=EXCLUDED.case_id,issued_by=EXCLUDED.issued_by,updated_at=now()',
      [subject, restricted, version + 1, caseId, auth.memberId],
    );
    await this.audit(
      db,
      auth.memberId,
      caseId,
      restricted ? 'PRECAUTIONARY_RESTRICTION' : 'RESTRICTION_LIFTED',
      requestId,
    );
    return { restricted, version: version + 1 };
  }
  async enforce(auth: Authority, key: string, input: unknown, requestId: string) {
    const d = enforcementSchema.parse(input);
    return this.staff(auth, (db) =>
      this.command(db, auth, key, { action: 'enforce', d }, async () => {
        if (d.caseId) {
          const r = await db.query('SELECT 1 FROM safety.report WHERE id=$1 AND subject_id=$2', [
            d.caseId,
            d.subjectId,
          ]);
          if (!r.rowCount) throw new StoreError('NOT_FOUND');
        }
        return this.setRestriction(
          db,
          auth,
          d.subjectId,
          d.version,
          d.restricted,
          d.caseId,
          requestId,
        );
      }),
    );
  }
  async ownEnforcement(auth: Authority) {
    return this.member(auth, async (db) => {
      const row = (
        await db.query<Enforcement>(
          'SELECT restricted,version FROM safety.enforcement WHERE member_id=$1',
          [auth.memberId],
        )
      ).rows[0];
      const appeals = await db.query<{ id: string; status: string; created_at: Date }>(
        'SELECT id,status,created_at FROM safety.appeal WHERE member_id=$1 ORDER BY created_at DESC',
        [auth.memberId],
      );
      return {
        restricted: row?.restricted ?? false,
        version: row?.version ?? 0,
        notice: row?.restricted ? restrictionNotice : null,
        appeals: appeals.rows,
      };
    });
  }
  async accountControl(auth: Authority, memberId: string, requestId: string) {
    return this.staff(auth, async (db) => {
      const row = (
        await db.query<{ restricted: boolean; version: number }>(
          'SELECT restricted,version FROM safety.enforcement WHERE member_id=$1',
          [memberId],
        )
      ).rows[0];
      await this.audit(db, auth.memberId, memberId, 'ACCOUNT_CONTROL_VIEW', requestId);
      return row ?? { restricted: false, version: 0 };
    });
  }
  async appeal(auth: Authority, key: string, input: unknown, requestId: string) {
    const d = appealSchema.parse(input);
    return this.member(auth, (db) =>
      this.command(db, auth, key, { action: 'appeal', d }, async () => {
        const r = await db.query<Enforcement>(
          'SELECT * FROM safety.enforcement WHERE member_id=$1 FOR SHARE',
          [auth.memberId],
        );
        if (!r.rows[0]?.restricted || r.rows[0].version !== d.version)
          throw new StoreError('STALE_VERSION');
        const old = await db.query<{ id: string }>(
          'SELECT id FROM safety.appeal WHERE member_id=$1 AND enforcement_version=$2',
          [auth.memberId, d.version],
        );
        if (old.rows[0]) return { id: old.rows[0].id, received: true };
        const id = randomUUID();
        await db.query(
          'INSERT INTO safety.appeal(id,member_id,enforcement_version,detail_cipher,challenged_actor) VALUES($1,$2,$3,$4,$5)',
          [
            id,
            auth.memberId,
            d.version,
            this.cipher.seal(d.detail, `appeal:${id}`),
            r.rows[0].issued_by,
          ],
        );
        await this.audit(db, auth.memberId, id, 'APPEAL_RECEIVED', requestId);
        return { id, received: true };
      }),
    );
  }
  async appeals(auth: Authority, requestId: string, page: number) {
    return this.staff(auth, async (db) => {
      const rows = await db.query<{
        id: string;
        member_id: string;
        detail_cipher: string;
        version: number;
        created_at: Date;
      }>(
        "SELECT * FROM safety.appeal WHERE status='OPEN' ORDER BY created_at,id LIMIT $1 OFFSET $2",
        [c.CASE_PAGE_SIZE, page * c.CASE_PAGE_SIZE],
      );
      for (const row of rows.rows)
        await this.audit(db, auth.memberId, row.id, 'APPEAL_VIEW', requestId);
      return rows.rows.map((r) => ({
        id: r.id,
        memberId: r.member_id,
        version: r.version,
        createdAt: r.created_at,
        detail: this.cipher.open<string>(r.detail_cipher, `appeal:${r.id}`),
      }));
    });
  }
  async decideAppeal(auth: Authority, id: string, key: string, input: unknown, requestId: string) {
    const d = appealDecisionSchema.parse(input);
    return this.staff(auth, (db) =>
      this.command(db, auth, key, { action: 'decide-appeal', id, d }, async () => {
        const row = (
          await db.query<{
            member_id: string;
            enforcement_version: number;
            version: number;
            status: string;
            challenged_actor: string | null;
          }>('SELECT * FROM safety.appeal WHERE id=$1 FOR UPDATE', [id])
        ).rows[0];
        if (!row || row.version !== d.version || row.status !== 'OPEN')
          throw new StoreError('STALE_VERSION');
        if (!precautionAllowed(auth.memberId, row.member_id)) throw new StoreError('FORBIDDEN');
        if (!canDecideAppeal(auth.memberId, row.member_id, row.challenged_actor))
          throw new StoreError('INDEPENDENT_REVIEW_REQUIRED');
        if (d.decision === 'LIFTED') {
          const current = (
            await db.query<Enforcement>('SELECT * FROM safety.enforcement WHERE member_id=$1', [
              row.member_id,
            ])
          ).rows[0];
          // An older appeal may never undo a newer enforcement decision.
          if (!current || current.version !== row.enforcement_version)
            throw new StoreError('STALE_VERSION');
          await this.setRestriction(
            db,
            auth,
            row.member_id,
            current.version,
            false,
            current.case_id,
            requestId,
          );
        }
        await db.query('UPDATE safety.appeal SET status=$2,version=version+1 WHERE id=$1', [
          id,
          d.decision,
        ]);
        await this.audit(db, auth.memberId, id, 'APPEAL_DECIDED', requestId);
        return { status: d.decision, version: d.version + 1 };
      }),
    );
  }
  async switches(auth: Authority, requestId: string) {
    return this.staff(auth, async (db) => {
      await this.audit(db, auth.memberId, null, 'SWITCHES_VIEW', requestId);
      const rows = await db.query<{
        scope: string;
        target: string;
        disabled: boolean;
        version: number;
      }>('SELECT scope,target,disabled,version FROM safety.kill_switch ORDER BY scope,target');
      return {
        config: { allGoDisabled: c.GO_DISABLED, newPersonGoDisabled: c.NEW_PERSON_GO_DISABLED },
        overrides: rows.rows,
      };
    });
  }
  async switch(auth: Authority, key: string, input: unknown, requestId: string) {
    const d = switchSchema.parse(input),
      target = d.target ?? 'GLOBAL';
    return this.staff(auth, (db) =>
      this.command(db, auth, key, { action: 'switch', d }, async () => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,22))', [
          `${d.scope}:${target}`,
        ]);
        const row = (
          await db.query<{ version: number }>(
            'SELECT version FROM safety.kill_switch WHERE scope=$1 AND target=$2 FOR UPDATE',
            [d.scope, target],
          )
        ).rows[0];
        if ((row?.version ?? 0) !== d.version) throw new StoreError('STALE_VERSION');
        await db.query(
          'INSERT INTO safety.kill_switch(scope,target,disabled,version) VALUES($1,$2,$3,$4) ON CONFLICT(scope,target) DO UPDATE SET disabled=EXCLUDED.disabled,version=EXCLUDED.version',
          [d.scope, target, d.disabled, d.version + 1],
        );
        await this.audit(db, auth.memberId, d.target, 'SWITCH_UPDATED', requestId);
        return { version: d.version + 1 };
      }),
    );
  }
  async auditLog(auth: Authority, requestId: string, page: number) {
    return this.staff(auth, async (db) => {
      await this.audit(db, auth.memberId, null, 'ACCESS_AUDIT_VIEW', requestId);
      return (
        await db.query(
          'SELECT id,actor_id,record_id,action,created_at FROM safety.case_access_audit ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',
          [c.CASE_PAGE_SIZE, page * c.CASE_PAGE_SIZE],
        )
      ).rows as {
        id: string;
        actor_id: string;
        record_id: string | null;
        action: string;
        created_at: Date;
      }[];
    });
  }
}
