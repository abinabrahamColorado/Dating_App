import type { PoolClient } from 'pg';
import { isDenied, type PairMember } from '@meetwell/core/safety';
import { ageOn, localDate, type Profile } from '@meetwell/core/accounts';
import { AccountStore, StoreError, transaction, type Authority } from './accounts';

export async function enforcementStatus(db: PoolClient, memberId: string): Promise<boolean> {
  return (
    await db.query<{ denied: boolean }>('SELECT app.enforcement_status($1) AS denied', [memberId])
  ).rows[0]!.denied;
}
/** Spec P20/P22, I-04. All member-to-member disclosures must enter here. No cached
 * permit escapes this transaction. Block/restriction writes lock the same rows.
 * Already delivered data cannot be recalled; the transaction commit orders races. */
export async function withMemberPair<T>(
  store: AccountStore,
  auth: Authority,
  subject: string,
  read: (db: PoolClient) => Promise<T>,
): Promise<T> {
  return store.withSession(auth, () =>
    transaction(store.app, async (db) => {
      await db.query('SELECT app.lock_pair($1,$2)', [auth.memberId, subject]);
      const members = await db.query<PairMember>(
        `SELECT id,state,deletion_requested_at IS NOT NULL AS deleted,
       app.enforcement_status(id) AS restricted,
       (EXISTS(SELECT 1 FROM app.blocks WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid) AND blocker_id=m.id)
        OR EXISTS(SELECT 1 FROM app.legacy_pair_denials WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid))) AS "blocksOther"
       FROM app.members m WHERE id IN($1,$2)`,
        [auth.memberId, subject],
      );
      const u = members.rows.find((r) => r.id === auth.memberId),
        v = members.rows.find((r) => r.id === subject);
      if (!u || !v || isDenied(u, v)) throw new StoreError('NOT_FOUND');
      const grant = await db.query(
        'SELECT 1 FROM app.profile_access WHERE viewer_id=$1 AND subject_id=$2 AND expires_at>clock_timestamp()',
        [auth.memberId, subject],
      );
      if (!grant.rowCount) throw new StoreError('NOT_FOUND');
      return read(db);
    }),
  );
}
/** Internal allowlist reader: caller must hold the pair guard through this read.
 * Only memberProfile and the M3 guarded card may call it (architecture test). */
export async function approvedProfileFields(store: AccountStore, db: PoolClient, subject: string) {
  const row = await db.query<{ body_cipher: string }>(
    'SELECT body_cipher FROM app.profiles WHERE member_id=$1',
    [subject],
  );
  if (!row.rowCount) throw new StoreError('NOT_FOUND');
  const p = store.appCipher.open<Profile>(row.rows[0]!.body_cipher, `profile:${subject}`);
  const identity = await store.identityConnection.query<{ birth_cipher: string }>(
    'SELECT birth_cipher FROM identity.users WHERE id=$1',
    [subject],
  );
  if (!identity.rows[0]?.birth_cipher) throw new StoreError('NOT_FOUND');
  const age = ageOn(
    store.identityCipher.open<string>(identity.rows[0].birth_cipher, `birth:${subject}`),
    localDate(new Date()),
  );
  const photos = await db.query<{ id: string }>(
    "SELECT id FROM app.media WHERE member_id=$1 AND status='APPROVED' ORDER BY created_at,id",
    [subject],
  );
  // Explicit allowlist: no birth date, area, availability, preferences, roles or enforcement reasons.
  return {
    id: subject,
    displayName: p.displayName,
    age,
    intention: p.intention,
    interests: p.interests,
    prompt: p.prompt,
    photos: photos.rows,
  };
}
export async function memberProfile(store: AccountStore, auth: Authority, subject: string) {
  return withMemberPair(store, auth, subject, async (db) =>
    approvedProfileFields(store, db, subject),
  );
}
export async function memberPhoto<T>(
  store: AccountStore,
  auth: Authority,
  subject: string,
  photo: string,
  load: () => Promise<T>,
) {
  return withMemberPair(store, auth, subject, async (db) => {
    const row = await db.query(
      "SELECT id FROM app.media WHERE id=$1 AND member_id=$2 AND status='APPROVED'",
      [photo, subject],
    );
    if (!row.rowCount) throw new StoreError('NOT_FOUND');
    return load();
  });
}
export async function blockMember(
  store: AccountStore,
  auth: Authority,
  subject: string,
  key: string,
) {
  if (subject === auth.memberId) throw new StoreError('INVALID_INPUT');
  return store.withSession(auth, () =>
    transaction(store.app, async (db) => {
      await db.query('SELECT app.lock_pair($1,$2)', [auth.memberId, subject]);
      const hash = store.lookup(JSON.stringify({ action: 'block', subject }));
      const prior = await db.query<{ request_hash: string }>(
        'SELECT request_hash FROM app.command_receipts WHERE member_id=$1 AND command_key=$2',
        [auth.memberId, key],
      );
      if (prior.rows[0] && prior.rows[0].request_hash !== hash)
        throw new StoreError('IDEMPOTENCY_CONFLICT');
      if (!prior.rowCount) {
        await db.query(
          'INSERT INTO app.blocks(low_id,high_id,blocker_id) VALUES(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),$1) ON CONFLICT DO NOTHING',
          [auth.memberId, subject],
        );
        await db.query(
          'INSERT INTO app.command_receipts(member_id,command_key,request_hash,result_cipher) VALUES($1,$2,$3,$4)',
          [
            auth.memberId,
            key,
            hash,
            store.appCipher.seal({ blocked: true }, `receipt:${auth.memberId}:${key}`),
          ],
        );
      }
      // No target lookup response, notification, narrative or reporting side effect.
      return { blocked: true };
    }),
  );
}
