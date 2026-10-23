import 'dotenv/config';
import { Pool } from 'pg';
// Explicit fixture command, never a production venue approval or a real address.
const url = process.env.MIGRATION_DATABASE_URL;
if (
  !url ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_dev') ||
  process.env.APP_MODE !== 'local'
)
  throw Error('Only local synthetic development is allowed');
const pool = new Pool({ connectionString: url });
try {
  await pool.query(
    "INSERT INTO app.explore_venues(id,name,public_centroid,approved,review_expires_at,synthetic) VALUES('00000000-0000-4000-8000-000000000301','Synthetic feasibility fixture — not a real meeting place',ST_SetSRID(ST_Point(-74.001,40.746),4326)::geography,true,now()+interval '1 year',true) ON CONFLICT(id) DO UPDATE SET approved=true,review_expires_at=EXCLUDED.review_expires_at WHERE app.explore_venues.synthetic",
  );
  process.stdout.write(
    'Synthetic public-centroid fixture ready. This does not approve any real meeting place.\n',
  );
} finally {
  await pool.end();
}
