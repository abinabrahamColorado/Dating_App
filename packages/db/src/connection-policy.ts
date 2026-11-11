import type { PoolClient } from 'pg';
import { isDenied, type PairMember } from '@meetwell/core/safety';
import { StoreError } from './accounts';
export type ConnectionRow = {
  id: string;
  low_id: string;
  high_id: string;
  state: string;
  slot_held: boolean;
  version: number;
  created_at: Date;
  closed_at: Date | null;
};
/** Fresh authorization at every read/send/delivery/plan transition, under the
 * same ordered member locks as block, restriction and account policy writes. */
export async function lockedConnection(db: PoolClient, id: string, actor?: string) {
  const row = (
    await db.query<ConnectionRow>(
      'SELECT o.*,c.created_at,c.closed_at FROM app.opportunities o JOIN app.connections c ON c.id=o.id WHERE o.id=$1',
      [id],
    )
  ).rows[0];
  if (!row || (actor && ![row.low_id, row.high_id].includes(actor)))
    throw new StoreError('NOT_FOUND');
  await db.query('SELECT app.lock_pair($1,$2)', [row.low_id, row.high_id]);
  const connection = (
    await db.query<ConnectionRow>(
      'SELECT o.*,c.created_at,c.closed_at FROM app.opportunities o JOIN app.connections c ON c.id=o.id WHERE o.id=$1 FOR UPDATE OF o,c',
      [id],
    )
  ).rows[0]!;
  const members = (
    await db.query<PairMember>(
      `SELECT id,state,pause_chat AS "pauseChat",deletion_requested_at IS NOT NULL AS deleted,app.enforcement_status(id) AS restricted,
    (EXISTS(SELECT 1 FROM app.blocks WHERE low_id=$1 AND high_id=$2 AND blocker_id=m.id)
    OR EXISTS(SELECT 1 FROM app.legacy_pair_denials WHERE low_id=$1 AND high_id=$2)) AS "blocksOther"
    FROM app.members m WHERE id IN ($1,$2)`,
      [row.low_id, row.high_id],
    )
  ).rows;
  const a = members.find((m) => m.id === row.low_id),
    b = members.find((m) => m.id === row.high_id);
  const allowed =
    !!a &&
    !!b &&
    !isDenied(a, b, 'CONNECTION') &&
    connection.state === 'MUTUAL' &&
    connection.slot_held &&
    !connection.closed_at;
  return { connection, allowed };
}
