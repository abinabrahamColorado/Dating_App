import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pilot } from '@meetwell/config/pilot';
import { connectionConfig } from '@meetwell/config/connections';
import {
  planningPreferencesSchema,
  defaultPlanningPreferences,
  messageSchema,
  meetingTimeSchema,
  planCommandSchema,
  sharedAvailability,
  venueEligible,
  rankVenues,
  publicVenue,
  calendarFile,
  canChangePlan,
  canConfirmPlan,
  confirmedPlanState,
  suggestArchive,
  type MeetingTime,
  type PublicVenue,
  type PlanState,
} from '@meetwell/core/connections';
import { AccountStore, StoreError, transaction, type Authority } from './accounts';
import { lockedConnection, type ConnectionRow } from './connection-policy';
import { databaseNow, loadExploreMember } from './explore-policy';
import { approvedProfileFields } from './member-access';
import { meetingVenues } from './venues';

type PlanRow = {
  id: string;
  connection_id: string;
  state: PlanState;
  version: number;
  revision: number;
  first_confirmed_at: Date | null;
  venue_id: string;
  venue_version: number;
  start_at: Date;
  minutes: number;
  venue_snapshot: PublicVenue;
};
type OptionSnapshot = { time: MeetingTime; venues: { id: string; version: number }[] };
export class ConnectionStore {
  constructor(readonly accounts: AccountStore) {}
  private async member<T>(
    auth: Authority,
    id: string,
    run: (db: PoolClient, c: ConnectionRow, allowed: boolean) => Promise<T>,
  ) {
    return this.accounts.withSession(auth, () =>
      transaction(this.accounts.app, async (db) => {
        const gate = await lockedConnection(db, id, auth.memberId);
        return run(db, gate.connection, gate.allowed);
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
      await db.query(
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
  private async preferences(db: PoolClient, c: ConnectionRow) {
    const rows = (
      await db.query<{ member_id: string; version: number; body_cipher: string }>(
        'SELECT * FROM app.planning_preferences WHERE connection_id=$1',
        [c.id],
      )
    ).rows;
    return [c.low_id, c.high_id].map((id) => {
      const r = rows.find((v) => v.member_id === id);
      return {
        memberId: id,
        version: r?.version ?? 0,
        data: r
          ? planningPreferencesSchema.parse(
              this.accounts.appCipher.open(r.body_cipher, `planning:${c.id}:${id}`),
            )
          : defaultPlanningPreferences,
      };
    });
  }
  private async context(db: PoolClient, c: ConnectionRow) {
    const now = await databaseNow(db),
      a = await loadExploreMember(db, this.accounts, c.low_id, now),
      b = await loadExploreMember(db, this.accounts, c.high_id, now);
    if (!a || !b) throw new StoreError('NOT_FOUND');
    return {
      now,
      a,
      b,
      preferences: await this.preferences(db, c),
      venues: await meetingVenues(db),
    };
  }
  private async refreshPlans(db: PoolClient, c: ConnectionRow) {
    const context = await this.context(db, c);
    const rows = (
      await db.query<PlanRow>(
        `SELECT p.*,v.* FROM app.plans p JOIN app.plan_versions v ON v.plan_id=p.id AND v.revision=p.revision WHERE p.connection_id=$1 AND p.state IN ('PROPOSED','CONFIRMED') ORDER BY p.id FOR UPDATE OF p`,
        [c.id],
      )
    ).rows;
    for (const p of rows) {
      if (new Date(p.start_at.getTime() + p.minutes * 60000) <= context.now) continue;
      const venue = context.venues.find((v) => v.id === p.venue_id),
        time = { start: p.start_at.toISOString(), minutes: p.minutes };
      // Once a meeting starts, recheck venue validity but do not invalidate merely
      // because the previously confirmed start is now in the past.
      const checkNow = new Date(Math.min(context.now.getTime(), p.start_at.getTime() - 1));
      if (
        !venue ||
        venue.version !== p.venue_version ||
        !venueEligible(
          venue,
          context.a.profile,
          context.b.profile,
          [context.a.age, context.b.age],
          context.preferences.map((x) => x.data),
          time,
          checkNow,
        )
      )
        await db.query(
          "UPDATE app.plans SET state='INVALIDATED',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2",
          [p.id, p.version],
        );
    }
    return context;
  }
  async view(auth: Authority, id: string, before?: string, plan?: string) {
    return this.member(auth, id, async (db, c, allowed) => {
      const subjectId = c.low_id === auth.memberId ? c.high_id : c.low_id;
      if (!allowed)
        return { status: c.closed_at ? ('ENDED' as const) : ('UNAVAILABLE' as const), subjectId };
      const context = await this.refreshPlans(db, c),
        profile = await approvedProfileFields(this.accounts, db, subjectId);
      const cursor = before
        ? (
            await db.query(
              "SELECT created_at,id FROM app.messages WHERE id=$1 AND connection_id=$2 AND (state='DELIVERED' OR sender_id=$3)",
              [before, id, auth.memberId],
            )
          ).rows[0]
        : null;
      if (before && !cursor) throw new StoreError('NOT_FOUND');
      const messages = (
        await db.query<{ id: string; sender_id: string; body_cipher: string; created_at: Date }>(
          `SELECT id,sender_id,body_cipher,created_at FROM app.messages WHERE connection_id=$1 AND (state='DELIVERED' OR (sender_id=$2 AND state='PENDING'))
        AND ($3::timestamptz IS NULL OR (created_at,id)<($3,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`,
          [
            id,
            auth.memberId,
            cursor?.created_at ?? null,
            cursor?.id ?? null,
            pilot.CHAT_PAGE_SIZE + 1,
          ],
        )
      ).rows;
      const plans = (
        await db.query<PlanRow>(
          `SELECT p.*,v.* FROM app.plans p JOIN app.plan_versions v ON v.plan_id=p.id AND v.revision=p.revision WHERE p.connection_id=$1 AND ($2::uuid IS NULL OR p.id=$2) ORDER BY p.created_at DESC,p.id LIMIT $3`,
          [id, plan ?? null, pilot.CHAT_PAGE_SIZE],
        )
      ).rows;
      if (plan && !plans.length) throw new StoreError('NOT_FOUND');
      const confirmations = (
        await db.query<{ plan_id: string; revision: number; member_id: string }>(
          'SELECT f.* FROM app.plan_confirmations f JOIN app.plans p ON p.id=f.plan_id WHERE p.connection_id=$1 AND f.revision=p.revision',
          [id],
        )
      ).rows;
      const progress = (
        await db.query(
          `SELECT greatest($2::timestamptz,(SELECT max(created_at) FROM app.messages WHERE connection_id=$1 AND state='DELIVERED'),(SELECT max(updated_at) FROM app.plans WHERE connection_id=$1)) AS at,
        (SELECT count(*)::int FROM app.plans WHERE connection_id=$1 AND first_confirmed_at IS NOT NULL) AS confirmed`,
          [id, c.created_at],
        )
      ).rows[0];
      const me = context.a.id === auth.memberId ? context.a : context.b;
      return {
        status: 'OPEN' as const,
        subjectId,
        profile,
        firstName: me.profile.displayName.split(/\s+/)[0]!,
        archiveSuggested: suggestArchive(progress.at, context.now),
        focusOffer: progress.confirmed >= pilot.FOCUS_OFFER_AFTER_CONFIRMED_PLANS,
        availability: sharedAvailability(context.a.profile, context.b.profile, context.now),
        preferences: context.preferences.find((x) => x.memberId === auth.memberId)!,
        messages: messages
          .slice(0, pilot.CHAT_PAGE_SIZE)
          .reverse()
          .map((m) => ({
            id: m.id,
            own: m.sender_id === auth.memberId,
            text: this.accounts.appCipher.open<string>(m.body_cipher, `message:${m.id}`),
            createdAt: m.created_at.toISOString(),
          })),
        earlier:
          messages.length > pilot.CHAT_PAGE_SIZE ? messages[pilot.CHAT_PAGE_SIZE - 1]!.id : null,
        plans: plans.map((p) => ({
          id: p.id,
          state: p.state,
          version: p.version,
          revision: p.revision,
          time: { start: p.start_at.toISOString(), minutes: p.minutes },
          venue: p.venue_snapshot,
          confirmedByYou: confirmations.some(
            (x) => x.plan_id === p.id && x.member_id === auth.memberId,
          ),
        })),
      };
    });
  }
  async send(auth: Authority, id: string, key: string, input: unknown) {
    const d = messageSchema.parse(input);
    return this.member(auth, id, async (db, _c, allowed) => {
      if (!allowed) throw new StoreError('CONNECTION_ENDED');
      return this.command(db, auth.memberId, key, { id, action: 'message', d }, async () => {
        const messageId = randomUUID();
        await db.query(
          'INSERT INTO app.messages(id,connection_id,sender_id,body_cipher) VALUES($1,$2,$3,$4)',
          [
            messageId,
            id,
            auth.memberId,
            this.accounts.appCipher.seal(d.text, `message:${messageId}`),
          ],
        );
        return { id: messageId };
      });
    });
  }
  async deliverOne(id: string) {
    return transaction(this.accounts.app, async (db) => {
      const row = (await db.query('SELECT connection_id FROM app.messages WHERE id=$1', [id]))
        .rows[0];
      if (!row) return false;
      const gate = await lockedConnection(db, row.connection_id);
      const changed = await db.query(
        "UPDATE app.messages SET state=$2,version=version+1 WHERE id=$1 AND state='PENDING'",
        [id, gate.allowed ? 'DELIVERED' : 'CANCELLED'],
      );
      return gate.allowed && changed.rowCount === 1;
    });
  }
  async deliverPending() {
    const ids = (
      await this.accounts.app.query<{ id: string }>(
        "SELECT id FROM app.messages WHERE state='PENDING' ORDER BY created_at,id LIMIT $1",
        [connectionConfig.WORK_BATCH_SIZE],
      )
    ).rows;
    for (const r of ids) await this.deliverOne(r.id);
  }
  async savePreferences(auth: Authority, id: string, key: string, input: unknown) {
    const d = z
      .object({ version: z.number().int().nonnegative(), data: planningPreferencesSchema })
      .strict()
      .parse(input);
    return this.member(auth, id, async (db, c, allowed) => {
      if (!allowed) throw new StoreError('CONNECTION_ENDED');
      return this.command(db, auth.memberId, key, { id, action: 'preferences', d }, async () => {
        const old = (await this.preferences(db, c)).find((p) => p.memberId === auth.memberId)!;
        if (old.version !== d.version) throw new StoreError('STALE_VERSION');
        await db.query(
          'INSERT INTO app.planning_preferences(connection_id,member_id,version,body_cipher) VALUES($1,$2,$3,$4) ON CONFLICT(connection_id,member_id) DO UPDATE SET version=EXCLUDED.version,body_cipher=EXCLUDED.body_cipher',
          [
            id,
            auth.memberId,
            d.version + 1,
            this.accounts.appCipher.seal(d.data, `planning:${id}:${auth.memberId}`),
          ],
        );
        await db.query(
          "UPDATE app.plans SET state='INVALIDATED',version=version+1,updated_at=clock_timestamp() WHERE connection_id=$1 AND state IN ('PROPOSED','CONFIRMED') AND EXISTS(SELECT 1 FROM app.plan_versions v WHERE v.plan_id=app.plans.id AND v.revision=app.plans.revision AND v.start_at>clock_timestamp())",
          [id],
        );
        return { version: d.version + 1 };
      });
    });
  }
  async options(auth: Authority, id: string, key: string, input: unknown) {
    const d = meetingTimeSchema.extend({ refresh: z.uuid().optional() }).parse(input);
    const time = { start: d.start, minutes: d.minutes };
    return this.member(auth, id, async (db, c, allowed) => {
      if (!allowed) throw new StoreError('CONNECTION_ENDED');
      const ctx = await this.context(db, c);
      const fingerprint = this.accounts.lookup(
        JSON.stringify({
          time,
          preferences: ctx.preferences.map((p) => p.version),
          refresh: d.refresh ?? null,
        }),
      );
      // Snapshot identity is shared by both people and independent of moving or
      // changing an area. Revalidate existing options; never silently replace them.
      const result = await this.command(
        db,
        auth.memberId,
        key,
        { id, action: 'options', d },
        async () => {
          const old = (
            await db.query(
              'SELECT id FROM app.plan_options WHERE connection_id=$1 AND fingerprint=$2',
              [id, fingerprint],
            )
          ).rows[0];
          if (old) return { id: old.id as string };
          const venues = rankVenues(
            ctx.venues.filter((v) =>
              venueEligible(
                v,
                ctx.a.profile,
                ctx.b.profile,
                [ctx.a.age, ctx.b.age],
                ctx.preferences.map((p) => p.data),
                time,
                ctx.now,
              ),
            ),
            ctx.a.profile,
            ctx.b.profile,
          );
          const snapshot: OptionSnapshot = {
              time,
              venues: venues.map((v) => ({ id: v.id, version: v.version })),
            },
            optionId = randomUUID();
          await db.query(
            'INSERT INTO app.plan_options(id,connection_id,fingerprint,body_cipher) VALUES($1,$2,$3,$4)',
            [
              optionId,
              id,
              fingerprint,
              this.accounts.appCipher.seal(snapshot, `options:${optionId}`),
            ],
          );
          return { id: optionId };
        },
      );
      const snapshot = await this.optionSnapshot(db, id, result.id);
      return {
        id: result.id,
        time: snapshot.time,
        venues: snapshot.venues.flatMap((s) => {
          const v = ctx.venues.find((v) => v.id === s.id && v.version === s.version);
          return v &&
            venueEligible(
              v,
              ctx.a.profile,
              ctx.b.profile,
              [ctx.a.age, ctx.b.age],
              ctx.preferences.map((p) => p.data),
              snapshot.time,
              ctx.now,
            )
            ? [publicVenue(v)]
            : [];
        }),
      };
    });
  }
  private async optionSnapshot(db: PoolClient, connection: string, id: string) {
    const r = (
      await db.query('SELECT body_cipher FROM app.plan_options WHERE id=$1 AND connection_id=$2', [
        id,
        connection,
      ])
    ).rows[0];
    if (!r) throw new StoreError('NOT_FOUND');
    return this.accounts.appCipher.open<OptionSnapshot>(r.body_cipher, `options:${id}`);
  }
  async plan(auth: Authority, id: string, key: string, input: unknown) {
    const d = planCommandSchema.parse(input);
    return this.member(auth, id, async (db, c, allowed) => {
      if (!allowed) throw new StoreError('CONNECTION_ENDED');
      const ctx = await this.refreshPlans(db, c);
      return this.command(db, auth.memberId, key, { id, action: 'plan', d }, async () => {
        const existing =
          d.action !== 'PROPOSE'
            ? (
                await db.query<PlanRow>(
                  'SELECT p.*,v.* FROM app.plans p JOIN app.plan_versions v ON v.plan_id=p.id AND v.revision=p.revision WHERE p.id=$1 AND p.connection_id=$2 FOR UPDATE OF p',
                  [d.planId, id],
                )
              ).rows[0]
            : null;
        if (d.action !== 'PROPOSE' && !existing) throw new StoreError('NOT_FOUND');
        if (d.action === 'PROPOSE' || d.action === 'CHANGE') {
          if (
            existing &&
            (!canChangePlan(existing.state) ||
              d.action !== 'CHANGE' ||
              existing.version !== d.version)
          )
            throw new StoreError('STALE_VERSION');
          const snapshot = await this.optionSnapshot(db, id, d.optionsId),
            offered = snapshot.venues.find((v) => v.id === d.venueId),
            venue = ctx.venues.find((v) => v.id === d.venueId);
          if (
            !offered ||
            !venue ||
            offered.version !== venue.version ||
            !venueEligible(
              venue,
              ctx.a.profile,
              ctx.b.profile,
              [ctx.a.age, ctx.b.age],
              ctx.preferences.map((p) => p.data),
              snapshot.time,
              ctx.now,
            )
          )
            throw new StoreError('PLAN_UNAVAILABLE');
          const planId = existing?.id ?? randomUUID(),
            revision = (existing?.revision ?? 0) + 1;
          if (existing)
            await db.query(
              "UPDATE app.plans SET revision=$2,version=version+1,state='PROPOSED',updated_at=clock_timestamp() WHERE id=$1 AND version=$3",
              [planId, revision, existing.version],
            );
          else
            await db.query('INSERT INTO app.plans(id,connection_id) VALUES($1,$2)', [planId, id]);
          await db.query(
            'INSERT INTO app.plan_versions(plan_id,revision,venue_id,venue_version,start_at,minutes,venue_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              planId,
              revision,
              venue.id,
              venue.version,
              snapshot.time.start,
              snapshot.time.minutes,
              publicVenue(venue),
            ],
          );
          return { id: planId, revision };
        }
        const p = existing!;
        if (d.action === 'CONFIRM') {
          if (!canConfirmPlan(p.state, p.revision, d.revision) || p.start_at <= ctx.now)
            throw new StoreError('STALE_VERSION');
          await db.query(
            'INSERT INTO app.plan_confirmations(plan_id,revision,member_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [p.id, p.revision, auth.memberId],
          );
          const count = (
            await db.query(
              'SELECT count(*)::int AS n FROM app.plan_confirmations WHERE plan_id=$1 AND revision=$2',
              [p.id, p.revision],
            )
          ).rows[0].n as number;
          const state = confirmedPlanState(count);
          const changed = await db.query(
            "UPDATE app.plans SET state=$2,version=version+1,first_confirmed_at=CASE WHEN $2='CONFIRMED' THEN coalesce(first_confirmed_at,clock_timestamp()) ELSE first_confirmed_at END,updated_at=clock_timestamp() WHERE id=$1 AND version=$3",
            [p.id, state, p.version],
          );
          if (changed.rowCount !== 1) throw new StoreError('STALE_VERSION');
        } else {
          if (p.version !== d.version || !canChangePlan(p.state))
            throw new StoreError('STALE_VERSION');
          await db.query(
            'UPDATE app.plans SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3',
            [p.id, d.action === 'CANCEL' ? 'CANCELLED' : 'DECLINED', p.version],
          );
        }
        return { id: p.id, revision: p.revision };
      });
    });
  }
  async calendar(auth: Authority, id: string, planId: string) {
    return this.member(auth, id, async (db, c, allowed) => {
      if (!allowed) throw new StoreError('CONNECTION_ENDED');
      await this.refreshPlans(db, c);
      const p = (
        await db.query<PlanRow>(
          "SELECT p.*,v.* FROM app.plans p JOIN app.plan_versions v ON v.plan_id=p.id AND v.revision=p.revision WHERE p.id=$1 AND p.connection_id=$2 AND p.state='CONFIRMED'",
          [planId, id],
        )
      ).rows[0];
      if (!p) throw new StoreError('PLAN_UNAVAILABLE');
      return {
        ics: calendarFile(p.id, p.venue_snapshot, {
          start: p.start_at.toISOString(),
          minutes: p.minutes,
        }),
      };
    });
  }
  async maintain() {
    const rows = (
      await this.accounts.app.query<{ id: string }>(
        `SELECT DISTINCT p.connection_id AS id FROM app.plans p JOIN app.plan_versions v ON v.plan_id=p.id AND v.revision=p.revision JOIN app.explore_venues e ON e.id=v.venue_id
      WHERE p.state IN ('PROPOSED','CONFIRMED') AND (NOT e.approved OR e.review_expires_at<=clock_timestamp() OR app.venue_disabled(e.id) OR e.version<>v.venue_version) ORDER BY id LIMIT $1`,
        [connectionConfig.WORK_BATCH_SIZE],
      )
    ).rows;
    for (const row of rows)
      await transaction(this.accounts.app, async (db) => {
        const gate = await lockedConnection(db, row.id);
        if (gate.allowed) await this.refreshPlans(db, gate.connection);
        else
          await db.query(
            "UPDATE app.plans SET state='INVALIDATED',version=version+1,updated_at=clock_timestamp() WHERE connection_id=$1 AND state IN ('PROPOSED','CONFIRMED')",
            [row.id],
          );
      });
  }
}
