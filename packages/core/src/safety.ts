import { z } from 'zod';
import { safetyConfig as c } from '@meetwell/config/safety';
import type { AccountState, StaffRole } from './accounts';

export type PairMember = {
  id: string;
  state: AccountState;
  deleted: boolean;
  restricted: boolean;
  blocksOther: boolean;
};
/** Spec P20/P22, I-04. The only bilateral deny policy. Facts must be loaded under
 * ordered locks at disclosure/commit, never supplied by the client or a cache. */
export function isDenied(u: PairMember, v: PairMember): boolean {
  return (
    u.id === v.id ||
    [u, v].some((m) => m.blocksOther || m.deleted || m.restricted || m.state !== 'ACTIVE')
  );
}
export function orderedPair(u: string, v: string): [string, string] {
  return u < v ? [u, v] : [v, u];
}
export function canReviewSafety(roles: readonly StaffRole[]) {
  return roles.includes('safety_reviewer');
}
export const safetyContextSchema = z
  .object({
    surface: z.enum([
      'profile',
      'settings',
      'card',
      'chat',
      'plan',
      'post-meeting',
      'after-unmatch',
    ]),
    referenceId: z.uuid().optional(),
  })
  .strict();
export const reportSchema = z
  .object({
    subjectId: z.uuid().nullable(),
    detail: z.string().trim().max(c.DETAIL_MAX).default(''),
    severity: z.enum(['STANDARD', 'HIGH', 'URGENT']).default('STANDARD'),
    context: safetyContextSchema,
  })
  .strict();
export type ReportInput = z.infer<typeof reportSchema>;
export const integritySchema = reportSchema.omit({ severity: true });
export const caseCommandSchema = z
  .object({
    version: z.number().int().nonnegative(),
    status: z.enum(['RECEIVED', 'IN_REVIEW', 'CLOSED']),
    severity: z.enum(['STANDARD', 'HIGH', 'URGENT']),
  })
  .strict();
export const enforcementSchema = z
  .object({
    subjectId: z.uuid(),
    version: z.number().int().nonnegative(),
    restricted: z.boolean(),
    caseId: z.uuid().nullable(),
  })
  .strict();
export const appealSchema = z
  .object({
    version: z.number().int().positive(),
    detail: z.string().trim().max(c.DETAIL_MAX).default(''),
  })
  .strict();
export const appealDecisionSchema = z
  .object({ version: z.number().int().nonnegative(), decision: z.enum(['UPHELD', 'LIFTED']) })
  .strict();
export const switchSchema = z
  .object({
    scope: z.enum(['VENUE', 'EVENT', 'ALL_GO', 'NEW_PERSON_GO']),
    target: z.uuid().nullable(),
    disabled: z.boolean(),
    version: z.number().int().nonnegative(),
  })
  .strict()
  .refine((v) => ['VENUE', 'EVENT'].includes(v.scope) === (v.target !== null));
export function precautionAllowed(actor: string, subject: string) {
  return actor !== subject;
}
export function canDecideAppeal(actor: string, subject: string, challengedActor: string | null) {
  return challengedActor !== null && actor !== subject && actor !== challengedActor;
}
export const restrictionNotice =
  'New interactions are temporarily unavailable while your account is reviewed. This precaution does not establish that an allegation is proven. You can request a review. Reporting and help remain available.';
