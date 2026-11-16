import { z } from 'zod';
import { pilot } from '@meetwell/config/pilot';
export const readinessSchema = z
  .object({
    gate: z.enum(['CONSENT_PRIVACY', 'OPERATIONS', 'EXPERIENCE']),
    version: z.number().int().nonnegative(),
    passed: z.boolean(),
    evidence: z.string().trim().min(1).max(2000),
  })
  .strict();
export type Readiness = Partial<
  Record<z.infer<typeof readinessSchema>['gate'], { passed: boolean; expiresAt: string }>
>;
export function readinessValid(reviews: Readiness, gate: keyof Readiness, now: string) {
  const r = reviews[gate];
  return !!r?.passed && Date.parse(r.expiresAt) > Date.parse(now);
}
export function readinessExpiry(now: Date) {
  return new Date(now.getTime() + pilot.READINESS_REVIEW_DAYS * 86400000);
}
