import { z } from 'zod';
import { launch, pilot } from '@meetwell/config/pilot';
import {
  accountConfig as c,
  genders,
  intentions,
  structures,
  transportModes,
  smokingValues,
  interests,
} from '@meetwell/config/accounts';

/** Spec P4/P22, I-01: date-only arithmetic in the launch timezone, never a DOB DTO. */
export function localDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: launch.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function ageOn(birthDate: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const parsed = new Date(`${birthDate}T12:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== birthDate ||
    birthDate > today
  )
    return null;
  return (
    Number(today.slice(0, 4)) -
    Number(birthDate.slice(0, 4)) -
    (today.slice(5) < birthDate.slice(5) ? 1 : 0)
  );
}
export function withinCohort(age: number | null): age is number {
  return age !== null && age >= launch.minimumAge && age <= launch.maximumAge;
}
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => [...v].every((ch) => ch.charCodeAt(0) >= 32 || ['\t', '\n', '\r'].includes(ch)),
      'Use plain text',
    );
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const areaSchema = z
  .string()
  .refine((v) => launch.areas.some((a) => a.id === v), 'Choose a launch area');
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
export const registerSchema = z
  .object({
    birthDate: z.string(),
    termsVersion: z.literal(c.TERMS_VERSION),
    privacyVersion: z.literal(c.PRIVACY_VERSION),
    accepted: z.literal(true),
  })
  .strict();
export const windowSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    start: z.number().int().min(0).max(1439),
    end: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((v) => v.end > v.start, 'End must follow start');
export const profileSchema = z
  .object({
    displayName: text(c.DISPLAY_NAME_MAX),
    gender: z.enum(genders),
    intention: z.enum(intentions),
    structure: z.enum(structures),
    areaId: areaSchema,
    travelMinutes: z.number().int().min(1).max(c.MAX_TRAVEL_MINUTES),
    transport: z.enum(transportModes),
    interests: z
      .array(z.enum(interests))
      .min(pilot.ONBOARDING_MIN_INTERESTS)
      .max(pilot.ONBOARDING_MAX_INTERESTS)
      .refine(unique),
    prompt: text(c.PROMPT_MAX),
    smoking: z.enum(smokingValues),
    availability: z
      .object({
        flexible: z.boolean(),
        windows: z.array(windowSchema).max(c.MAX_WEEKLY_WINDOWS),
      })
      .strict(),
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;
const setting = z.enum(['HARD', 'STRONG', 'NONE']);
const choice = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .object({
      setting,
      values: z.array(z.enum(values)).max(values.length).refine(unique),
    })
    .strict()
    .refine((v) => v.setting === 'NONE' || v.values.length > 0, 'Choose at least one value');
export const preferencesSchema = z
  .object({
    whoToMeet: z.array(z.enum(genders)).min(1).max(genders.length).refine(unique),
    age: z
      .object({
        setting,
        min: z.number().int().min(launch.minimumAge).max(launch.maximumAge),
        max: z.number().int().min(launch.minimumAge).max(launch.maximumAge),
      })
      .strict()
      .refine((v) => v.max >= v.min),
    intention: choice(intentions),
    structure: choice(structures),
    smoking: choice(['no', 'sometimes', 'yes'] as const),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const initialPreferences: Preferences = {
  whoToMeet: [],
  age: { setting: 'HARD', min: launch.minimumAge, max: launch.maximumAge },
  intention: { setting: 'NONE', values: [] },
  structure: { setting: 'NONE', values: [] },
  smoking: { setting: 'NONE', values: [] },
};
export type EligibilityMember = { age: number; profile: Profile; preferences: Preferences };
/** Spec P11/P12, I-02: structural gates and every explicit hard boundary, in both directions.
 * This is the M1 preference gate only; M3 composes safety, capacity and feasibility.
 */
export function boundariesAllow(a: EligibilityMember, b: EligibilityMember): boolean {
  const direction = (u: EligibilityMember, v: EligibilityMember) => {
    const p = u.preferences;
    return (
      p.whoToMeet.includes(v.profile.gender) &&
      (p.age.setting !== 'HARD' || (v.age >= p.age.min && v.age <= p.age.max)) &&
      (p.intention.setting !== 'HARD' || p.intention.values.includes(v.profile.intention)) &&
      (p.structure.setting !== 'HARD' || p.structure.values.includes(v.profile.structure)) &&
      (p.smoking.setting !== 'HARD' ||
        (v.profile.smoking !== 'not-stated' && p.smoking.values.includes(v.profile.smoking)))
    );
  };
  return withinCohort(a.age) && withinCohort(b.age) && direction(a, b) && direction(b, a);
}
export const states = ['ONBOARDING', 'ACTIVE', 'PAUSED', 'EXITED', 'RESTRICTED'] as const;
export type AccountState = (typeof states)[number];
export type Policy = {
  state: AccountState;
  intent: 'EXPLORE' | 'FOCUS';
  nearby: 'GHOST';
  version: number;
  epoch: number;
  pauseChat: boolean;
  planReminders: boolean;
  deletionRequested: boolean;
};
export type Readiness = { eligible: boolean; profileComplete: boolean; approvedPhotos: number };
export function ready(r: Readiness): boolean {
  return r.eligible && r.profileComplete && r.approvedPhotos >= pilot.PROFILE_MIN_PHOTOS;
}
export const policyCommandSchema = z
  .object({
    action: z.enum(['ACTIVATE', 'PAUSE', 'RESUME', 'FOCUS', 'EXPLORE', 'EXIT', 'DELETE']),
    version: z.number().int().nonnegative(),
    pauseChat: z.boolean().optional(),
    planReminders: z.boolean().optional(),
    exitReason: z.enum(['met-someone-here', 'taking-a-break', 'other']).optional(),
  })
  .strict();
export type PolicyCommand = z.infer<typeof policyCommandSchema>;
/** Spec P5, I-13. No member action can restore RESTRICTED/EXITED/deleted accounts. */
export function transitionPolicy(p: Policy, cmd: PolicyCommand, r: Readiness): Policy {
  if (cmd.version !== p.version) throw new Error('STALE_VERSION');
  if (p.deletionRequested) throw new Error('ACCOUNT_DISABLED');
  if (
    cmd.action !== 'DELETE' &&
    cmd.action !== 'EXIT' &&
    (p.state === 'EXITED' || p.state === 'RESTRICTED')
  )
    throw new Error('ACCOUNT_DISABLED');
  const next = { ...p, version: p.version + 1, epoch: p.epoch + 1, nearby: 'GHOST' as const };
  switch (cmd.action) {
    case 'DELETE':
      return { ...next, state: 'EXITED', deletionRequested: true };
    case 'EXIT':
      return { ...next, state: 'EXITED' };
    case 'PAUSE':
      return {
        ...next,
        state: 'PAUSED',
        pauseChat: cmd.pauseChat ?? false,
        planReminders: cmd.planReminders ?? false,
      };
    case 'ACTIVATE':
    case 'RESUME':
      if (!ready(r) || !['ONBOARDING', 'PAUSED'].includes(p.state)) throw new Error('NOT_READY');
      return { ...next, state: 'ACTIVE', intent: 'EXPLORE' };
    case 'FOCUS':
    case 'EXPLORE':
      if (p.state !== 'ACTIVE') throw new Error('NOT_READY');
      return { ...next, intent: cmd.action };
  }
}
/** Spec P5: derived capacity; Ghost affects only nearby, not Explore. */
export function discoveryPermission(p: Policy, r: Readiness, heldSlots: number, limit: number) {
  if (p.deletionRequested || p.state !== 'ACTIVE') return 'ACCOUNT';
  if (p.intent === 'FOCUS') return 'FOCUS';
  if (heldSlots >= limit) return 'CAPACITY';
  if (!ready(r)) return 'ELIGIBILITY';
  return 'EXPLORE';
}
export type StaffRole = 'operator' | 'safety_reviewer' | 'admin';
export function staffAccessAllowed(policy: Policy): boolean {
  return !policy.deletionRequested && !['EXITED', 'RESTRICTED'].includes(policy.state);
}
export function canModerate(roles: readonly StaffRole[]): boolean {
  return roles.includes('operator') || roles.includes('admin');
}
