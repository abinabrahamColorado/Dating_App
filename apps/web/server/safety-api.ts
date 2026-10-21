import { z } from 'zod';
import type { Authority } from '@meetwell/db/accounts';
import { StoreError } from '@meetwell/db/accounts';
import { blockMember, memberProfile, memberPhoto } from '@meetwell/db/member-access';
import { accountConfig } from '@meetwell/config/accounts';
import { safetyConfig } from '@meetwell/config/safety';
import { store } from './runtime';
import { safetyStore } from './safety-runtime';
import { getPhoto } from './media';

const uuid = z.uuid();
type Context = {
  auth: Authority;
  requestId: string;
  request: Request;
  path: string[];
  body: () => Promise<unknown>;
  key: () => string;
};
/** Exhaustive M2 route inventory. The architecture test verifies the call graph
 * of member-data handlers and rejects new unclassified routes/jobs. */
export const safetyRoutes = {
  'GET members/:id': 'member-data',
  'GET members/:id/photos/:photo': 'member-data',
  'POST safety/block': 'support-write',
  'POST safety/reports': 'support-write',
  'POST safety/integrity': 'support-write',
  'GET safety/cases': 'own-status',
  'GET safety/cases/:id': 'own-status',
  'GET safety/enforcement': 'own-status',
  'POST safety/appeal': 'support-write',
  'GET ops/safety/reports': 'staff',
  'GET ops/safety/integrity': 'staff',
  'GET ops/safety/reports/:id': 'staff',
  'GET ops/safety/integrity/:id': 'staff',
  'POST ops/safety/reports/:id': 'staff',
  'POST ops/safety/integrity/:id': 'staff',
  'POST ops/safety/enforcement': 'staff',
  'GET ops/safety/enforcement/:id': 'staff',
  'GET ops/safety/appeals': 'staff',
  'POST ops/safety/appeals/:id': 'staff',
  'GET ops/safety/switches': 'staff',
  'POST ops/safety/switches': 'staff',
  'GET ops/safety/audit': 'staff',
} as const;
export async function handleSafety(c: Context): Promise<unknown> {
  const p = c.path,
    auth = c.auth;
  const normalized = p
    .map((s, i) =>
      uuid.safeParse(s).success ? (p[0] === 'members' && i === 3 ? ':photo' : ':id') : s,
    )
    .join('/');
  const route = `${c.request.method} ${normalized}` as keyof typeof safetyRoutes;
  if (!Object.hasOwn(safetyRoutes, route)) throw new StoreError('NOT_FOUND');
  if (route === 'GET members/:id') return memberProfile(store(), auth, uuid.parse(p[1]));
  if (route === 'GET members/:id/photos/:photo')
    return memberPhoto(store(), auth, uuid.parse(p[1]), uuid.parse(p[3]), () =>
      getPhoto(uuid.parse(p[3])),
    );
  // No member-to-member data is served below. Report/block/help are independent.
  if (route === 'POST safety/block') {
    const d = z
      .object({ subjectId: uuid })
      .strict()
      .parse(await c.body());
    return blockMember(store(), auth, d.subjectId, c.key());
  }
  const db = safetyStore();
  if (
    ['POST safety/reports', 'POST safety/integrity'].includes(route) &&
    !(await store().rateLimit(
      `safety-submit:${auth.memberId}`,
      safetyConfig.REQUESTS_PER_HOUR,
      3600,
    ))
  )
    throw new StoreError('RATE_LIMITED');
  if (route === 'POST safety/reports') return db.report(auth, c.key(), await c.body(), c.requestId);
  if (route === 'POST safety/integrity')
    return db.report(auth, c.key(), await c.body(), c.requestId, true);
  if (route === 'GET safety/cases') return db.ownCases(auth, c.requestId);
  if (route === 'GET safety/cases/:id') return db.ownCase(auth, uuid.parse(p[2]), c.requestId);
  if (route === 'GET safety/enforcement') return db.ownEnforcement(auth);
  if (route === 'POST safety/appeal') return db.appeal(auth, c.key(), await c.body(), c.requestId);
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000)
    .parse(new URL(c.request.url).searchParams.get('page') ?? 0);
  if (p[2] === 'reports' || p[2] === 'integrity') {
    const kind = p[2] === 'reports' ? 'report' : 'integrity';
    if (p.length === 3) return db.queue(auth, kind, c.requestId, page);
    if (c.request.method === 'GET') return db.view(auth, uuid.parse(p[3]), kind, c.requestId);
    return db.updateCase(auth, uuid.parse(p[3]), kind, c.key(), await c.body(), c.requestId);
  }
  if (route === 'GET ops/safety/appeals') return db.appeals(auth, c.requestId, page);
  if (route === 'GET ops/safety/enforcement/:id')
    return db.accountControl(auth, uuid.parse(p[3]), c.requestId);
  if (route === 'GET ops/safety/switches') return db.switches(auth, c.requestId);
  if (route === 'GET ops/safety/audit') return db.auditLog(auth, c.requestId, page);
  if (Date.now() - auth.authenticatedAt.getTime() > accountConfig.REAUTH_MINUTES * 60000)
    throw new StoreError('REAUTH_REQUIRED');
  if (route === 'POST ops/safety/enforcement')
    return db.enforce(auth, c.key(), await c.body(), c.requestId);
  if (route === 'POST ops/safety/appeals/:id')
    return db.decideAppeal(auth, uuid.parse(p[3]), c.key(), await c.body(), c.requestId);
  if (route === 'POST ops/safety/switches')
    return db.switch(auth, c.key(), await c.body(), c.requestId);
  throw new StoreError('NOT_FOUND');
}
