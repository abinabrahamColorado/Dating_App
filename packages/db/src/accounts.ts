import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { pgSchema, uuid, text, integer } from 'drizzle-orm/pg-core';
import { Envelope, hashToken, lookupToken, newToken } from './encryption';
import { accountConfig as config } from '@meetwell/config/accounts';
import { pilot } from '@meetwell/config/pilot';
import {
  ageOn,
  localDate,
  withinCohort,
  profileSchema,
  preferencesSchema,
  registerSchema,
  transitionPolicy,
  canModerate,
  staffAccessAllowed,
  type Policy,
  type PolicyCommand,
  type Profile,
  type Preferences,
  type StaffRole,
} from '@meetwell/core/accounts';

const profiles = pgSchema('app').table('profiles', {
  memberId: uuid('member_id').primaryKey(),
  body: text('body_cipher').notNull(),
  version: integer('version').notNull(),
});
export class StoreError extends Error {}
export async function transaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
type MemberRow = {
  id: string;
  state: Policy['state'];
  intent: Policy['intent'];
  nearby: 'GHOST';
  version: number;
  epoch: number;
  pause_chat: boolean;
  plan_reminders: boolean;
  deletion_requested_at: Date | null;
};
function policyOf(row: MemberRow): Policy {
  return {
    state: row.state,
    intent: row.intent,
    nearby: row.nearby,
    version: row.version,
    epoch: row.epoch,
    pauseChat: row.pause_chat,
    planReminders: row.plan_reminders,
    deletionRequested: row.deletion_requested_at !== null,
  };
}
export type Authority = {
  memberId: string;
  sessionId: string;
  authenticatedAt: Date;
  age: number | null;
  registered: boolean;
};
export type Photo = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REMOVED';
  version: number;
};
export type StoreOptions = {
  identity: Pool;
  app: Pool;
  ops: Pool;
  identityKey: string;
  appKey: string;
  lookupKey: string;
};
/** Boundary-specific pools are distinct LOGIN identities in runtime; no administrator fallback. */
export class AccountStore {
  readonly identity: Pool;
  readonly app: Pool;
  readonly ops: Pool;
  readonly identityCipher: Envelope;
  readonly appCipher: Envelope;
  private lookupKey: string;
  constructor(options: StoreOptions) {
    this.identity = options.identity;
    this.app = options.app;
    this.ops = options.ops;
    this.identityCipher = new Envelope(options.identityKey);
    this.appCipher = new Envelope(options.appKey);
    this.lookupKey = options.lookupKey;
  }
  lookup(value: string) {
    return lookupToken(this.lookupKey, value);
  }
  /** Atomic DB budget; contains keyed tokens, never raw email/IP/location. */
  async rateLimit(bucket: string, maximum: number, seconds: number): Promise<boolean> {
    const result = await this.identity.query<{ requests: number }>(
      `
      INSERT INTO identity.rate_limits(bucket, window_start, requests) VALUES($1, now(), 1)
      ON CONFLICT(bucket) DO UPDATE SET
        requests = CASE WHEN identity.rate_limits.window_start <= now() - $2 * interval '1 second'
          THEN 1 ELSE identity.rate_limits.requests + 1 END,
        window_start = CASE WHEN identity.rate_limits.window_start <= now() - $2 * interval '1 second'
          THEN now() ELSE identity.rate_limits.window_start END
      RETURNING requests`,
      [bucket, seconds],
    );
    return result.rows[0]!.requests <= maximum;
  }
  async requestMagicLink(email: string, browser: string): Promise<string | null> {
    const allowed = await this.rateLimit(
      `email:${this.lookup(email)}`,
      config.AUTH_REQUESTS_PER_HOUR,
      3600,
    );
    const global = await this.rateLimit('auth:global', config.AUTH_GLOBAL_REQUESTS_PER_HOUR, 3600);
    if (!allowed || !global) return null; // Same external response as successful delivery.
    const id = randomUUID(),
      token = newToken();
    await this.identity.query(
      `INSERT INTO identity.magic_links
      (id,email_lookup,payload_cipher,token_hash,browser_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,now() + $6 * interval '1 minute')`,
      [
        id,
        this.lookup(email),
        this.identityCipher.seal({ email, token }, `magic:${id}`),
        hashToken(token),
        hashToken(browser),
        config.MAGIC_LINK_MINUTES,
      ],
    );
    return id;
  }
  /** Each message commits independently, so a poison row cannot roll back prior sends.
   * The adapter MUST bound SMTP waits. SKIP LOCKED permits concurrent runners without
   * holding a whole batch. A crash after SMTP acceptance can still duplicate mail;
   * single-use authentication tokens, not exactly-once SMTP, enforce login authority.
   */
  async deliverMagicLinks(send: (email: string, token: string) => Promise<void>) {
    const result = { sent: 0, failed: 0 };
    for (let i = 0; i < config.AUTH_OUTBOX_BATCH_SIZE; i++) {
      const outcome = await transaction(this.identity, async (db) => {
        const pending = await db.query<{ id: string; payload_cipher: string }>(
          `SELECT id,payload_cipher FROM identity.magic_links
           WHERE sent_at IS NULL AND consumed_at IS NULL AND expires_at > now()
             AND next_attempt_at <= now() AND attempts < $1
           ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [config.AUTH_OUTBOX_MAX_ATTEMPTS],
        );
        const row = pending.rows[0];
        if (!row) return null;
        let delivered = false;
        try {
          const payload = this.identityCipher.open<{ email: string; token: string }>(
            row.payload_cipher,
            `magic:${row.id}`,
          );
          await send(payload.email, payload.token);
          delivered = true;
        } catch {
          // Persist only retry metadata. Provider errors may contain emails or tokens.
        }
        // DB errors must propagate: never report a committed outcome after an uncertain write.
        await db.query(
          `UPDATE identity.magic_links SET attempts=attempts+1,
             sent_at=CASE WHEN $2 THEN clock_timestamp() ELSE NULL END,
             next_attempt_at=clock_timestamp()+$3*interval '1 second' WHERE id=$1`,
          [row.id, delivered, config.AUTH_OUTBOX_RETRY_SECONDS],
        );
        return delivered ? 'sent' : 'failed';
      });
      if (!outcome) break;
      result[outcome]++;
    }
    return result;
  }
  async consumeMagicLink(
    token: string,
    browser: string,
  ): Promise<{ token: string; memberId: string }> {
    const result = await transaction(this.identity, async (db) => {
      const consumed = await db.query<{ id: string; email_lookup: string; payload_cipher: string }>(
        `
        UPDATE identity.magic_links SET consumed_at=now()
        WHERE token_hash=$1 AND browser_hash=$2 AND expires_at>now() AND consumed_at IS NULL
        RETURNING id,email_lookup,payload_cipher`,
        [hashToken(token), hashToken(browser)],
      );
      const link = consumed.rows[0];
      if (!link) throw new StoreError('INVALID_LINK');
      const { email } = this.identityCipher.open<{ email: string }>(
        link.payload_cipher,
        `magic:${link.id}`,
      );
      const newId = randomUUID();
      const user = await db.query<{ id: string }>(
        `INSERT INTO identity.users(id,email_lookup,email_cipher)
        VALUES($1,$2,$3) ON CONFLICT(email_lookup) DO UPDATE SET email_lookup=EXCLUDED.email_lookup RETURNING id`,
        [newId, link.email_lookup, this.identityCipher.seal(email, `email:${newId}`)],
      );
      const memberId = user.rows[0]!.id;
      const sessionToken = newToken();
      await db.query(
        `INSERT INTO identity.sessions(id,member_id,token_hash,expires_at)
        VALUES($1,$2,$3,now()+$4*interval '1 day')`,
        [randomUUID(), memberId, hashToken(sessionToken), config.SESSION_DAYS],
      );
      return { token: sessionToken, memberId };
    });
    // Idempotent recovery if a process dies between identity commit and app initialization.
    await this.ensureMember(result.memberId);
    return result;
  }
  async ensureMember(memberId: string) {
    await this.app.query('INSERT INTO app.members(id) VALUES($1) ON CONFLICT DO NOTHING', [
      memberId,
    ]);
  }
  async authority(token: string, now = new Date()): Promise<Authority | null> {
    const result = await this.identity.query<{
      id: string;
      member_id: string;
      authenticated_at: Date;
      birth_cipher: string | null;
      registered_at: Date | null;
    }>(
      `SELECT s.id,s.member_id,s.authenticated_at,u.birth_cipher,u.registered_at
       FROM identity.sessions s JOIN identity.users u ON u.id=s.member_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    await this.ensureMember(row.member_id);
    const policy = await this.policy(row.member_id);
    if (policy.deletionRequested) return null;
    return {
      memberId: row.member_id,
      sessionId: row.id,
      authenticatedAt: row.authenticated_at,
      registered: row.registered_at !== null,
      age: row.birth_cipher
        ? ageOn(
            this.identityCipher.open<string>(row.birth_cipher, `birth:${row.member_id}`),
            localDate(now),
          )
        : null,
    };
  }
  async register(memberId: string, input: unknown, now = new Date()) {
    const data = registerSchema.parse(input);
    if (!withinCohort(ageOn(data.birthDate, localDate(now))))
      throw new StoreError('AGE_INELIGIBLE');
    await transaction(this.identity, async (db) => {
      const user = await db.query<{ registered_at: Date | null }>(
        'SELECT registered_at FROM identity.users WHERE id=$1 FOR UPDATE',
        [memberId],
      );
      if (!user.rows[0] || user.rows[0].registered_at) throw new StoreError('ALREADY_REGISTERED');
      await db.query('UPDATE identity.users SET birth_cipher=$2,registered_at=now() WHERE id=$1', [
        memberId,
        this.identityCipher.seal(data.birthDate, `birth:${memberId}`),
      ]);
      for (const [purpose, version] of [
        ['terms', data.termsVersion],
        ['privacy', data.privacyVersion],
      ]) {
        await db.query(
          'INSERT INTO identity.consents(id,member_id,purpose,document_version) VALUES($1,$2,$3,$4)',
          [randomUUID(), memberId, purpose, version],
        );
      }
    });
  }
  async policy(memberId: string): Promise<Policy> {
    const r = await this.app.query<MemberRow>('SELECT * FROM app.members WHERE id=$1', [memberId]);
    if (!r.rows[0]) throw new StoreError('NOT_FOUND');
    return policyOf(r.rows[0]);
  }
  async profile(memberId: string): Promise<{ data: Profile; version: number } | null> {
    const [row] = await drizzle(this.app)
      .select()
      .from(profiles)
      .where(eq(profiles.memberId, memberId));
    return row
      ? {
          data: profileSchema.parse(this.appCipher.open(row.body, `profile:${memberId}`)),
          version: row.version,
        }
      : null;
  }
  async preferenceHistory(memberId: string) {
    const r = await this.app.query<{
      version: number;
      prior_version: number;
      source: 'USER';
      scope: string;
      body_cipher: string;
      created_at: Date;
    }>('SELECT * FROM app.preference_versions WHERE member_id=$1 ORDER BY version DESC', [
      memberId,
    ]);
    return r.rows.map((row) => ({
      version: row.version,
      priorVersion: row.prior_version,
      source: row.source,
      scope: row.scope,
      updatedAt: row.created_at.toISOString(),
      data: preferencesSchema.parse(
        this.appCipher.open(row.body_cipher, `preferences:${memberId}:${row.version}`),
      ),
    }));
  }
  async photos(memberId: string): Promise<Photo[]> {
    return (
      await this.app.query<Photo>(
        'SELECT id,status,version FROM app.media WHERE member_id=$1 AND status<>$2 ORDER BY created_at,id',
        [memberId, 'REMOVED'],
      )
    ).rows;
  }
  private async mutate<T>(
    memberId: string,
    key: string,
    payload: unknown,
    run: (db: PoolClient, policy: Policy) => Promise<T>,
    allowDisabled = false,
  ): Promise<T> {
    return transaction(this.app, async (db) => {
      const member = await db.query<MemberRow>('SELECT * FROM app.members WHERE id=$1 FOR UPDATE', [
        memberId,
      ]);
      if (!member.rows[0]) throw new StoreError('NOT_FOUND');
      const requestHash = this.lookup(JSON.stringify(payload));
      const receipt = await db.query<{ request_hash: string; result_cipher: string }>(
        'SELECT * FROM app.command_receipts WHERE member_id=$1 AND command_key=$2',
        [memberId, key],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== requestHash)
          throw new StoreError('IDEMPOTENCY_CONFLICT');
        return this.appCipher.open<T>(receipt.rows[0].result_cipher, `receipt:${memberId}:${key}`);
      }
      const policy = policyOf(member.rows[0]);
      if (
        !allowDisabled &&
        (policy.deletionRequested || ['EXITED', 'RESTRICTED'].includes(policy.state))
      )
        throw new StoreError('ACCOUNT_DISABLED');
      const result = await run(db, policy);
      await db.query(
        'INSERT INTO app.command_receipts(member_id,command_key,request_hash,result_cipher) VALUES($1,$2,$3,$4)',
        [memberId, key, requestHash, this.appCipher.seal(result, `receipt:${memberId}:${key}`)],
      );
      return result;
    });
  }
  async saveProfile(memberId: string, key: string, version: number, data: Profile) {
    const clean = profileSchema.parse(data);
    return this.mutate(memberId, key, { action: 'profile', version, data: clean }, async (db) => {
      const r = await db.query<{ version: number }>(
        'SELECT version FROM app.profiles WHERE member_id=$1',
        [memberId],
      );
      if ((r.rows[0]?.version ?? 0) !== version) throw new StoreError('STALE_VERSION');
      await db.query(
        `INSERT INTO app.profiles(member_id,body_cipher,version) VALUES($1,$2,$3)
        ON CONFLICT(member_id) DO UPDATE SET body_cipher=EXCLUDED.body_cipher,version=EXCLUDED.version,updated_at=now()`,
        [memberId, this.appCipher.seal(clean, `profile:${memberId}`), version + 1],
      );
      await db.query('UPDATE app.members SET epoch=epoch+1,version=version+1 WHERE id=$1', [
        memberId,
      ]);
      return { version: version + 1 };
    });
  }
  async savePreferences(memberId: string, key: string, version: number, data: Preferences) {
    const clean = preferencesSchema.parse(data);
    return this.mutate(
      memberId,
      key,
      { action: 'preferences', version, data: clean },
      async (db) => {
        const r = await db.query<{ version: number | null }>(
          'SELECT max(version) AS version FROM app.preference_versions WHERE member_id=$1',
          [memberId],
        );
        if ((r.rows[0]?.version ?? 0) !== version) throw new StoreError('STALE_VERSION');
        await db.query(
          'INSERT INTO app.preference_versions(member_id,version,prior_version,body_cipher) VALUES($1,$2,$3,$4)',
          [
            memberId,
            version + 1,
            version,
            this.appCipher.seal(clean, `preferences:${memberId}:${version + 1}`),
          ],
        );
        await db.query('UPDATE app.members SET epoch=epoch+1,version=version+1 WHERE id=$1', [
          memberId,
        ]);
        return { version: version + 1 };
      },
    );
  }
  async addPhoto(
    memberId: string,
    key: string,
    contentHash: string,
    write: (photoId: string) => Promise<void>,
  ) {
    return this.mutate(memberId, key, { action: 'add-photo', contentHash }, async (db) => {
      const count = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM app.media WHERE member_id=$1 AND status<>'REMOVED'",
        [memberId],
      );
      if (count.rows[0]!.count >= pilot.PROFILE_MAX_PHOTOS) throw new StoreError('PHOTO_LIMIT');
      const photoId = randomUUID();
      await write(photoId);
      await db.query('INSERT INTO app.media(id,member_id) VALUES($1,$2)', [photoId, memberId]);
      return { id: photoId };
    });
  }
  async removePhoto(memberId: string, key: string, photoId: string) {
    return this.mutate(memberId, key, { action: 'remove-photo', photoId }, async (db) => {
      const photo = await db.query('SELECT id FROM app.lock_member_media($2) WHERE id=$1', [
        photoId,
        memberId,
      ]);
      if (!photo.rowCount) throw new StoreError('NOT_FOUND');
      await db.query('SELECT app.remove_media($1,$2)', [photoId, memberId]);
      // Revoke discovery immediately. Restoration requires a fresh eligibility check.
      await db.query(
        `UPDATE app.members SET state=CASE WHEN state='ACTIVE' THEN 'ONBOARDING' ELSE state END,
        version=version+1,epoch=epoch+1 WHERE id=$1`,
        [memberId],
      );
      return { removed: true };
    });
  }
  async changePolicy(authority: Authority, key: string, command: PolicyCommand) {
    const result = await this.mutate(
      authority.memberId,
      key,
      command,
      async (db, policy) => {
        const profile = await db.query('SELECT 1 FROM app.profiles WHERE member_id=$1', [
          authority.memberId,
        ]);
        const preferences = await db.query(
          'SELECT 1 FROM app.preference_versions WHERE member_id=$1 LIMIT 1',
          [authority.memberId],
        );
        // Lock media rows so moderation/removal cannot invalidate readiness before commit.
        const photos = await db.query<Photo>(
          'SELECT id,status,version FROM app.lock_member_media($1)',
          [authority.memberId],
        );
        const next = transitionPolicy(policy, command, {
          eligible: withinCohort(authority.age),
          profileComplete: !!profile.rowCount && !!preferences.rowCount,
          approvedPhotos: photos.rows.filter((p) => p.status === 'APPROVED').length,
        });
        await db.query(
          `UPDATE app.members SET state=$2,intent=$3,nearby=$4,version=$5,epoch=$6,
        pause_chat=$7,plan_reminders=$8,deletion_requested_at=CASE WHEN $9 THEN now() ELSE deletion_requested_at END,
        exit_reason=CASE WHEN $10::text IS NOT NULL THEN $10 ELSE exit_reason END WHERE id=$1`,
          [
            authority.memberId,
            next.state,
            next.intent,
            next.nearby,
            next.version,
            next.epoch,
            next.pauseChat,
            next.planReminders,
            next.deletionRequested,
            command.exitReason ?? null,
          ],
        );
        return next;
      },
      true,
    );
    if (result.deletionRequested) {
      await this.identity.query(
        'UPDATE identity.sessions SET revoked_at=now() WHERE member_id=$1 AND revoked_at IS NULL',
        [authority.memberId],
      );
    }
    return result;
  }
  async sessions(authority: Authority) {
    const r = await this.identity.query<{ id: string; created_at: Date; expires_at: Date }>(
      `SELECT id,created_at,expires_at FROM identity.sessions WHERE member_id=$1 AND revoked_at IS NULL
       AND expires_at>now() ORDER BY created_at DESC LIMIT $2`,
      [authority.memberId, config.SESSION_LIST_MAX],
    );
    return r.rows.map((row) => ({
      id: row.id,
      current: row.id === authority.sessionId,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }
  async revokeSessions(authority: Authority, others: boolean) {
    await this.identity.query(
      `UPDATE identity.sessions SET revoked_at=now()
      WHERE member_id=$1 AND ${others ? 'id<>$2' : 'id=$2'}`,
      [authority.memberId, authority.sessionId],
    );
  }
  async staffRoles(memberId: string): Promise<StaffRole[]> {
    if (!staffAccessAllowed(await this.policy(memberId))) return [];
    return (
      await this.ops.query<{ role: StaffRole }>('SELECT role FROM ops.staff WHERE member_id=$1', [
        memberId,
      ])
    ).rows.map((r) => r.role);
  }
  private async audit(
    db: PoolClient,
    actor: string,
    action: string,
    subject: string | null,
    requestId: string,
  ) {
    await db.query(
      'INSERT INTO ops.audit(id,actor_id,action,subject_id,request_id) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), actor, action, subject, requestId],
    );
  }
  private async requireModerator(memberId: string) {
    if (!canModerate(await this.staffRoles(memberId))) throw new StoreError('FORBIDDEN');
  }
  async moderationQueue(actor: string, requestId: string) {
    await this.requireModerator(actor);
    return transaction(this.ops, async (db) => {
      await this.audit(db, actor, 'QUEUE_READ', null, requestId);
      return (
        await db.query<Photo>(
          `SELECT id,status,version FROM app.media WHERE status='PENDING'
        ORDER BY created_at,id LIMIT $1`,
          [config.OPS_PAGE_SIZE],
        )
      ).rows;
    });
  }
  async photoAccess(
    authority: Authority,
    photoId: string,
    review: boolean,
    requestId: string,
  ): Promise<void> {
    if (review) {
      await this.requireModerator(authority.memberId);
      await transaction(this.ops, async (db) => {
        const row = await db.query(
          "SELECT id FROM app.media WHERE id=$1 AND status='PENDING' FOR SHARE",
          [photoId],
        );
        if (!row.rowCount) throw new StoreError('NOT_FOUND');
        await this.audit(db, authority.memberId, 'MEDIA_READ', photoId, requestId);
      });
    } else {
      const row = await this.app.query(
        "SELECT id FROM app.media WHERE id=$1 AND member_id=$2 AND status<>'REMOVED'",
        [photoId, authority.memberId],
      );
      if (!row.rowCount) throw new StoreError('NOT_FOUND');
    }
  }
  async moderate(
    actor: string,
    key: string,
    photoId: string,
    version: number,
    approve: boolean,
    requestId: string,
  ) {
    await this.requireModerator(actor);
    return transaction(this.ops, async (db) => {
      const hash = this.lookup(JSON.stringify({ photoId, version, approve }));
      const photo = await db.query<Photo & { member_id: string }>(
        'SELECT id,status,version,member_id FROM app.media WHERE id=$1 FOR UPDATE',
        [photoId],
      );
      if (photo.rows[0]?.member_id === actor) throw new StoreError('FORBIDDEN');
      const old = await db.query<{ request_hash: string; result: Photo }>(
        'SELECT request_hash,result FROM ops.moderation_receipts WHERE actor_id=$1 AND command_key=$2',
        [actor, key],
      );
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== hash) throw new StoreError('IDEMPOTENCY_CONFLICT');
        return old.rows[0].result;
      }
      if (!photo.rows[0] || photo.rows[0].status !== 'PENDING' || photo.rows[0].version !== version)
        throw new StoreError('STALE_VERSION');
      const next: Photo = {
        id: photoId,
        status: approve ? 'APPROVED' : 'REJECTED',
        version: version + 1,
      };
      await db.query('UPDATE app.media SET status=$2,version=$3 WHERE id=$1', [
        photoId,
        next.status,
        next.version,
      ]);
      await this.audit(
        db,
        actor,
        approve ? 'MEDIA_APPROVED' : 'MEDIA_REJECTED',
        photoId,
        requestId,
      );
      await db.query(
        'INSERT INTO ops.moderation_receipts(actor_id,command_key,request_hash,result) VALUES($1,$2,$3,$4)',
        [actor, key, hash, next],
      );
      return next;
    });
  }
  async auditLog(actor: string, requestId: string) {
    if (!(await this.staffRoles(actor)).includes('admin')) throw new StoreError('FORBIDDEN');
    return transaction(this.ops, async (db) => {
      await this.audit(db, actor, 'AUDIT_READ', null, requestId);
      return (
        await db.query(
          'SELECT id,actor_id,action,subject_id,created_at FROM ops.audit ORDER BY created_at DESC LIMIT $1',
          [config.OPS_PAGE_SIZE],
        )
      ).rows;
    });
  }
}
