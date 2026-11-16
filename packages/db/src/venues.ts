import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pilot } from '@meetwell/config/pilot';
import {
  venueDetailsSchema,
  venueWriteSchema,
  type MeetingVenue,
  type VenueWrite,
} from '@meetwell/core/connections';
import { AccountStore, StoreError, type Authority } from './accounts';

export async function meetingVenues(db: PoolClient): Promise<MeetingVenue[]> {
  await db.query('SELECT pg_advisory_xact_lock_shared(40,1)');
  const rows = (
    await db.query(`SELECT id,name,version,details,approved,review_expires_at,alcohol_primary,
    ST_Y(public_centroid::geometry) AS lat,ST_X(public_centroid::geometry) AS lon,
    app.venue_disabled(id) AS disabled FROM app.explore_venues ORDER BY id`)
  ).rows;
  return rows.flatMap((r) => {
    const d = venueDetailsSchema.safeParse(r.details);
    return d.success
      ? [
          {
            id: r.id,
            name: r.name,
            version: r.version,
            details: d.data,
            approved: r.approved,
            reviewExpiresAt: r.review_expires_at.toISOString(),
            alcoholPrimary: r.alcohol_primary,
            centroid: [r.lat, r.lon] as const,
            disabled: r.disabled,
          },
        ]
      : [];
  });
}
export class VenueStore {
  constructor(readonly accounts: AccountStore) {}
  async list(auth: Authority, requestId: string, page = 0) {
    return this.accounts.withSession(auth, () =>
      this.accounts.withStaff(auth.memberId, ['operator', 'admin'], async (db) => {
        await db.query('SELECT pg_advisory_xact_lock_shared(40,1)');
        const rows = (
          await db.query(
            `SELECT v.*,ST_Y(public_centroid::geometry) AS lat,ST_X(public_centroid::geometry) AS lon,
        app.venue_disabled(v.id) AS disabled,p.body_cipher FROM app.explore_venues v LEFT JOIN ops.venue_private p ON p.venue_id=v.id
        ORDER BY v.name,v.id LIMIT $1 OFFSET $2`,
            [pilot.EXPLORE_WORK_BATCH_SIZE, page * pilot.EXPLORE_WORK_BATCH_SIZE],
          )
        ).rows;
        for (const r of rows)
          await db.query(
            'INSERT INTO ops.audit(id,actor_id,action,request_id,subject_id) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), auth.memberId, 'VENUE_READ', requestId, r.id],
          );
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          version: r.version,
          latitude: r.lat,
          longitude: r.lon,
          approved: r.approved,
          alcoholPrimary: r.alcohol_primary,
          reviewExpiresAt: r.review_expires_at.toISOString(),
          details: r.details,
          disabled: r.disabled,
          ...(r.body_cipher
            ? this.accounts.appCipher.open<
                Pick<
                  VenueWrite,
                  'partnered' | 'partnerContact' | 'trainingStatus' | 'complaintHistory'
                >
              >(r.body_cipher, `venue:${r.id}`)
            : { partnered: false, partnerContact: '', trainingStatus: '', complaintHistory: '' }),
        }));
      }),
    );
  }
  async save(auth: Authority, key: string, input: unknown, requestId: string) {
    const d = venueWriteSchema.parse(input);
    return this.accounts.withSession(auth, () =>
      this.accounts.withStaff(auth.memberId, ['operator', 'admin'], async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(40,1)');
        const hash = this.accounts.lookup(JSON.stringify(d));
        const prior = (
          await db.query(
            'SELECT request_hash,result FROM ops.venue_receipts WHERE actor_id=$1 AND command_key=$2',
            [auth.memberId, key],
          )
        ).rows[0];
        if (prior) {
          if (prior.request_hash !== hash) throw new StoreError('IDEMPOTENCY_CONFLICT');
          return prior.result as { id: string; version: number };
        }
        const now = (await db.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
        if (
          d.approved &&
          (new Date(d.reviewExpiresAt) <= now || new Date(d.details.reviewDate) > now)
        )
          throw new StoreError('INVALID_INPUT');
        const old = (
          await db.query('SELECT version FROM app.explore_venues WHERE id=$1 FOR UPDATE', [d.id])
        ).rows[0];
        if ((old?.version ?? 0) !== d.version) throw new StoreError('STALE_VERSION');
        const args = [
          d.id,
          d.name,
          d.longitude,
          d.latitude,
          d.approved,
          d.reviewExpiresAt,
          d.alcoholPrimary,
          d.version + 1,
          JSON.stringify(d.details),
        ];
        await db.query(
          `INSERT INTO app.explore_venues(id,name,public_centroid,approved,review_expires_at,alcohol_primary,version,details)
        VALUES($1,$2,ST_SetSRID(ST_Point($3,$4),4326)::geography,$5,$6,$7,$8,$9)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,public_centroid=EXCLUDED.public_centroid,approved=EXCLUDED.approved,
        review_expires_at=EXCLUDED.review_expires_at,alcohol_primary=EXCLUDED.alcohol_primary,version=EXCLUDED.version,details=EXCLUDED.details`,
          args,
        );
        await db.query(
          'INSERT INTO ops.venue_private(venue_id,body_cipher) VALUES($1,$2) ON CONFLICT(venue_id) DO UPDATE SET body_cipher=EXCLUDED.body_cipher',
          [
            d.id,
            this.accounts.appCipher.seal(
              {
                partnered: d.partnered,
                partnerContact: d.partnerContact,
                trainingStatus: d.trainingStatus,
                complaintHistory: d.complaintHistory,
              },
              `venue:${d.id}`,
            ),
          ],
        );
        await db.query(
          'INSERT INTO ops.audit(id,actor_id,action,request_id,subject_id) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), auth.memberId, 'VENUE_REVIEWED', requestId, d.id],
        );
        const result = { id: d.id, version: d.version + 1 };
        await db.query(
          'INSERT INTO ops.venue_receipts(actor_id,command_key,request_hash,result) VALUES($1,$2,$3,$4)',
          [auth.memberId, key, hash, result],
        );
        return result;
      }),
    );
  }
}
