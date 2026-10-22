import type { PoolClient } from 'pg';
import { pilot } from '@meetwell/config/pilot';
import { ageOn, localDate, profileSchema, preferencesSchema } from '@meetwell/core/accounts';
import { isDenied } from '@meetwell/core/safety';
import {
  eligible,
  weekKey,
  type ExploreMember,
  type PairFacts,
  type Venue,
  type EligibilityStage,
} from '@meetwell/core/explore';
import { AccountStore } from './accounts';

export async function databaseNow(db: PoolClient) {
  return (await db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
}
export async function ensureLedger(db: PoolClient, id: string, week: string) {
  await db.query(
    'INSERT INTO app.capacity_ledger(member_id,cap_limit) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [id, pilot.MAX_ACTIVE_CONNECTIONS],
  );
  await db.query(
    'INSERT INTO app.exposure_week(member_id,week) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [id, week],
  );
}
/** Caller holds ordered member locks. Profile writes use those same rows; media
 * revocation waits for these media locks until the decision commits. */
export async function loadExploreMember(
  db: PoolClient,
  store: AccountStore,
  id: string,
  now: Date,
): Promise<ExploreMember | null> {
  const r = (
    await db.query(
      `SELECT m.*,p.body_cipher AS profile,p.version AS profile_version,
  c.held,c.cap_limit,c.last_offer_at,w.delivered,w.pending,
  app.enforcement_status(m.id) AS restricted,
  (SELECT body_cipher FROM app.preference_versions WHERE member_id=m.id ORDER BY version DESC LIMIT 1) AS preferences,
  (SELECT max(version) FROM app.preference_versions WHERE member_id=m.id) AS preference_version
  FROM app.members m LEFT JOIN app.profiles p ON p.member_id=m.id
  LEFT JOIN app.capacity_ledger c ON c.member_id=m.id
  LEFT JOIN app.exposure_week w ON w.member_id=m.id AND w.week=$2
  WHERE m.id=$1`,
      [id, weekKey(now)],
    )
  ).rows[0];
  if (!r || !r.profile || !r.preferences) return null;
  const photos = await db.query(
    "SELECT id FROM app.lock_member_media($1) WHERE status='APPROVED' ORDER BY id",
    [id],
  );
  const identity = (
    await store.identity.query<{ birth_cipher: string | null; registered_at: Date | null }>(
      'SELECT birth_cipher,registered_at FROM identity.users WHERE id=$1',
      [id],
    )
  ).rows[0];
  if (!identity?.birth_cipher || !identity.registered_at) return null;
  let profile, preferences, age;
  try {
    profile = profileSchema.parse(store.appCipher.open(r.profile, `profile:${id}`));
    preferences = preferencesSchema.parse(
      store.appCipher.open(r.preferences, `preferences:${id}:${r.preference_version}`),
    );
    age = ageOn(
      store.identityCipher.open<string>(identity.birth_cipher, `birth:${id}`),
      localDate(now),
    );
  } catch {
    return null;
  } // Corrupt/unreadable records never become candidates or logs.
  if (age === null) return null;
  return {
    id,
    state: r.state,
    intent: r.intent,
    deleted: r.deletion_requested_at !== null,
    restricted: r.restricted,
    age,
    profile,
    preferences,
    complete: true,
    approvedPhotos: photos.rowCount ?? 0,
    freeSlots: (r.cap_limit ?? pilot.MAX_ACTIVE_CONNECTIONS) - (r.held ?? 0),
    remainingWeekly: pilot.MAX_NEW_INTROS_PER_WEEK - (r.delivered ?? 0) - (r.pending ?? 0),
    lastOfferAt: r.last_offer_at?.toISOString() ?? null,
    joinedAt: r.created_at.toISOString(),
    profileVersion: r.profile_version,
    preferenceVersion: r.preference_version,
    policyVersion: r.version,
  };
}
export async function loadVenues(db: PoolClient): Promise<Venue[]> {
  const rows =
    await db.query(`SELECT id,ST_Y(public_centroid::geometry) AS lat,ST_X(public_centroid::geometry) AS lon,
  approved,review_expires_at,alcohol_primary FROM app.lock_explore_venues() ORDER BY id`);
  return rows.rows.map((r) => ({
    id: r.id,
    centroid: [r.lat, r.lon],
    approved: r.approved,
    reviewExpiresAt: r.review_expires_at.toISOString(),
    alcoholPrimary: r.alcohol_primary,
  }));
}
export async function loadPairFacts(db: PoolClient, u: string, v: string): Promise<PairFacts> {
  const blocks = (
    await db.query<{ blocker_id: string }>(
      'SELECT blocker_id FROM app.blocks WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)',
      [u, v],
    )
  ).rows;
  const r = (
    await db.query<{ legacy: boolean; history: boolean }>(
      `SELECT
  EXISTS(SELECT 1 FROM app.legacy_pair_denials WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)) AS legacy,
  EXISTS(SELECT 1 FROM app.pair_history WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)) AS history`,
      [u, v],
    )
  ).rows[0]!;
  return {
    u,
    v,
    blockedBy: blocks.map((b) => b.blocker_id),
    legacyDenied: r.legacy,
    hasHistory: r.history,
  };
}
/** I-04: authoritative shared gate for every M3 retrieval/reserve/deliver/accept.
 * Returned facts must never leave this transaction as a cached permission. */
export async function lockedExplorePair(
  db: PoolClient,
  store: AccountStore,
  u: string,
  v: string,
  stage: EligibilityStage,
) {
  await db.query('SELECT app.lock_pair($1,$2)', [u, v]);
  const now = await databaseNow(db),
    facts = await loadPairFacts(db, u, v);
  const a = await loadExploreMember(db, store, u, now),
    b = await loadExploreMember(db, store, v, now);
  const denied =
    !a ||
    !b ||
    isDenied(
      { ...a, blocksOther: facts.legacyDenied || facts.blockedBy.includes(u) },
      { ...b, blocksOther: facts.legacyDenied || facts.blockedBy.includes(v) },
    );
  const venues = await loadVenues(db);
  return {
    now,
    a,
    b,
    facts,
    venues,
    allowed: !denied && a !== null && b !== null && eligible(a, b, now, facts, venues, stage),
  };
}
