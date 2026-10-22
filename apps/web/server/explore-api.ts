import { z } from 'zod';
import { StoreError, type Authority } from '@meetwell/db/accounts';
import { ExploreStore } from '@meetwell/db/explore';
import { pilot } from '@meetwell/config/pilot';
import { store } from './runtime';

const uuid = z.uuid();
const editSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('APPROVE'), version: z.number().int().min(0) }).strict(),
  z
    .object({ action: z.literal('REMOVE'), version: z.number().int().min(0), opportunityId: uuid })
    .strict(),
  z
    .object({ action: z.literal('ADD'), version: z.number().int().min(0), u: uuid, v: uuid })
    .strict(),
]);
export const exploreRoutes = {
  'GET explore': 'own-status',
  'POST explore/capacity': 'own-write',
  'GET explore/:id': 'member-data',
  'POST explore/:id/decide': 'member-transition',
  'POST explore/:id/close': 'authority-revocation',
  'GET ops/explore': 'staff',
  'POST ops/explore': 'staff-member-allocation',
  'GET ops/explore/:id': 'staff-member-data',
  'POST ops/explore/:id': 'staff-member-allocation',
} as const;
export async function handleExplore(c: {
  auth: Authority;
  requestId: string;
  request: Request;
  path: string[];
  body: () => Promise<unknown>;
  key: () => string;
}) {
  const route = `${c.request.method} ${c.path.map((p) => (uuid.safeParse(p).success ? ':id' : p)).join('/')}`;
  if (!Object.hasOwn(exploreRoutes, route)) throw new StoreError('NOT_FOUND');
  if (
    !(await store().rateLimit(`explore:${c.auth.memberId}`, pilot.EXPLORE_REQUESTS_PER_MINUTE, 60))
  )
    throw new StoreError('RATE_LIMITED');
  const db = new ExploreStore(store());
  if (route === 'GET explore') return db.own(c.auth);
  if (route === 'POST explore/capacity') return db.capacity(c.auth, c.key(), await c.body());
  if (route === 'GET explore/:id') return db.card(c.auth, uuid.parse(c.path[1]));
  if (route === 'POST explore/:id/decide')
    return db.decide(c.auth, uuid.parse(c.path[1]), c.key(), await c.body());
  if (route === 'POST explore/:id/close') {
    z.object({})
      .strict()
      .parse(await c.body());
    return db.close(c.auth, uuid.parse(c.path[1]), c.key());
  }
  if (route === 'GET ops/explore') return db.batches(c.auth, c.requestId);
  if (route === 'POST ops/explore')
    return db.generate(c.auth, c.key(), await c.body(), c.requestId);
  if (route === 'GET ops/explore/:id') return db.review(c.auth, uuid.parse(c.path[2]), c.requestId);
  if (route === 'POST ops/explore/:id')
    return db.edit(
      c.auth,
      uuid.parse(c.path[2]),
      c.key(),
      editSchema.parse(await c.body()),
      c.requestId,
    );
  throw new StoreError('NOT_FOUND');
}
