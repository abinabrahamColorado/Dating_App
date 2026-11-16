import { z } from 'zod';
import { after } from 'next/server';
import { StoreError, type Authority } from '@meetwell/db/accounts';
import { ConnectionStore } from '@meetwell/db/connections';
import { VenueStore } from '@meetwell/db/venues';
import { requireSupportedClient } from '@meetwell/db/client-policy';
import { pilot } from '@meetwell/config/pilot';
import { store } from './runtime';
const uuid = z.uuid();
export const connectionRoutes = {
  'GET connections/:id': 'member-data',
  'POST connections/:id/messages': 'member-send',
  'POST connections/:id/preferences': 'own-preferences',
  'POST connections/:id/options': 'member-plan-options',
  'POST connections/:id/plans': 'member-plan-transition',
  'GET connections/:id/plans/:id/calendar': 'member-plan-data',
  'GET ops/venues': 'staff-private-venue-data',
  'POST ops/venues': 'staff-venue-review',
} as const;
export async function handleConnections(c: {
  auth: Authority;
  requestId: string;
  request: Request;
  path: string[];
  body: () => Promise<unknown>;
  key: () => string;
}) {
  const route = `${c.request.method} ${c.path.map((p) => (uuid.safeParse(p).success ? ':id' : p)).join('/')}`;
  if (!Object.hasOwn(connectionRoutes, route)) throw new StoreError('NOT_FOUND');
  if (
    !(await store().rateLimit(
      `connections:${c.auth.memberId}`,
      pilot.CONNECTION_REQUESTS_PER_MINUTE,
      60,
    ))
  )
    throw new StoreError('RATE_LIMITED');
  const db = new ConnectionStore(store()),
    venues = new VenueStore(store()),
    query = new URL(c.request.url).searchParams;
  if (route === 'GET connections/:id')
    return db.view(
      c.auth,
      uuid.parse(c.path[1]),
      uuid.optional().parse(query.get('before') ?? undefined),
      uuid.optional().parse(query.get('plan') ?? undefined),
    );
  if (route === 'POST connections/:id/messages') {
    const result = await db.send(c.auth, uuid.parse(c.path[1]), c.key(), await c.body());
    after(async () => {
      try {
        await requireSupportedClient(db.accounts, 'worker/connections', 'POST', null);
        await db.deliverOne(result.id);
      } catch {
        /* Durable pg-boss sweep retries without plaintext job payloads. */
      }
    });
    return result;
  }
  if (route === 'POST connections/:id/preferences')
    return db.savePreferences(c.auth, uuid.parse(c.path[1]), c.key(), await c.body());
  if (route === 'POST connections/:id/options')
    return db.options(c.auth, uuid.parse(c.path[1]), c.key(), await c.body());
  if (route === 'POST connections/:id/plans')
    return db.plan(c.auth, uuid.parse(c.path[1]), c.key(), await c.body());
  if (route === 'GET connections/:id/plans/:id/calendar')
    return db.calendar(c.auth, uuid.parse(c.path[1]), uuid.parse(c.path[3]));
  if (route === 'GET ops/venues')
    return venues.list(
      c.auth,
      c.requestId,
      z.coerce
        .number()
        .int()
        .min(0)
        .max(1000)
        .parse(query.get('page') ?? 0),
    );
  if (route === 'POST ops/venues') return venues.save(c.auth, c.key(), await c.body(), c.requestId);
  throw new StoreError('NOT_FOUND');
}
