import { z } from 'zod';
import { StoreError, type Authority } from '@meetwell/db/accounts';
import { FeedbackStore } from '@meetwell/db/feedback';
import { MetricStore } from '@meetwell/db/metrics';
import { lifecycleConfig } from '@meetwell/config/lifecycle';
import { store } from './runtime';
const uuid = z.uuid();
export const lifecycleRoutes = {
  'GET feedback': 'own-feedback',
  'POST feedback/:id/present': 'own-feedback',
  'POST feedback/:id/answer': 'own-feedback',
  'POST feedback/:id/invite': 'member-send',
  'POST feedback/:id/second-meeting': 'own-feedback',
  'POST outcomes/exit': 'own-outcome',
  'GET outcomes/followups': 'own-outcome',
  'POST outcomes/followups/30': 'own-outcome',
  'POST outcomes/followups/90': 'own-outcome',
  'GET outcomes/attention': 'own-consent',
  'POST outcomes/attention': 'own-consent',
  'GET ops/metrics': 'staff-aggregate',
  'POST ops/metrics': 'staff-cohort',
  'GET ops/metrics/readiness': 'staff-private-review',
  'POST ops/metrics/readiness': 'staff-private-review',
} as const;
export async function handleLifecycle(c: {
  auth: Authority;
  request: Request;
  path: string[];
  requestId: string;
  body: () => Promise<unknown>;
  key: () => string;
}) {
  const route = `${c.request.method} ${c.path.map((x) => (uuid.safeParse(x).success ? ':id' : x)).join('/')}`;
  if (!Object.hasOwn(lifecycleRoutes, route)) throw new StoreError('NOT_FOUND');
  if (
    !(await store().rateLimit(
      `lifecycle:${c.auth.memberId}`,
      lifecycleConfig.REQUESTS_PER_MINUTE,
      60,
    ))
  )
    throw new StoreError('RATE_LIMITED');
  const feedback = new FeedbackStore(store()),
    metrics = new MetricStore(store());
  if (route === 'GET ops/metrics/readiness') return metrics.readiness(c.auth, c.requestId);
  if (route === 'POST ops/metrics/readiness')
    return metrics.review(c.auth, c.key(), await c.body(), c.requestId);
  if (route === 'GET feedback') return feedback.list(c.auth);
  if (route === 'POST feedback/:id/present')
    return feedback.present(
      c.auth,
      uuid.parse(c.path[1]),
      c.key(),
      z
        .object({ dismiss: z.boolean() })
        .strict()
        .parse(await c.body()).dismiss,
    );
  if (route === 'POST feedback/:id/answer')
    return feedback.answer(c.auth, uuid.parse(c.path[1]), c.key(), await c.body());
  if (route === 'POST feedback/:id/invite') {
    z.object({})
      .strict()
      .parse(await c.body());
    return feedback.invite(c.auth, uuid.parse(c.path[1]), c.key());
  }
  if (route === 'POST feedback/:id/second-meeting')
    return feedback.secondMeeting(c.auth, uuid.parse(c.path[1]), c.key(), await c.body());
  if (route === 'POST outcomes/exit') return feedback.exit(c.auth, c.key(), await c.body());
  if (route === 'GET outcomes/followups') return feedback.followups(c.auth);
  if (route.startsWith('POST outcomes/followups/'))
    return feedback.followup(c.auth, Number(c.path[2]), c.key(), await c.body());
  if (route === 'GET outcomes/attention') return feedback.attentionConsent(c.auth);
  if (route === 'POST outcomes/attention')
    return feedback.attention(c.auth, c.key(), await c.body());
  if (route === 'GET ops/metrics') return metrics.list(c.auth, c.requestId);
  if (route === 'POST ops/metrics') {
    z.object({ action: z.literal('FREEZE') })
      .strict()
      .parse(await c.body());
    return metrics.freeze(c.auth, c.key(), c.requestId);
  }
  throw new StoreError('NOT_FOUND');
}
