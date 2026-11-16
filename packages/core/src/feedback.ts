import { z } from 'zod';
import { launch, pilot } from '@meetwell/config/pilot';
import { localMeetingInstant, zonedParts } from './connections';

export const matchingChips = [
  'Easy conversation',
  'Felt attraction',
  'Shared outlook',
  'No spark',
  'Different goals',
  'Different lifestyle',
] as const;
export const attendanceValues = ['YES', 'NO', 'PREFER_NOT_TO_SAY'] as const;
export const experienceValues = ['YES', 'NOT_SURE', 'NO', 'SKIP'] as const;
export const attendanceProvenance = [
  'BOTH_REPORTED',
  'ONE_REPORTED',
  'HOST_CONFIRMED_FOR_EVENT',
  'DISPUTED',
  'UNKNOWN',
] as const;
export type AttendanceAnswer = (typeof attendanceValues)[number] | null;
export type ExperienceAnswer = (typeof experienceValues)[number] | null;
export type Feedback = {
  met: AttendanceAnswer;
  again: ExperienceAnswer;
  chips: (typeof matchingChips)[number][];
};
export const feedbackSchema = z
  .object({
    met: z.enum(attendanceValues),
    again: z.enum(experienceValues).nullable(),
    chips: z.array(z.enum(matchingChips)).max(pilot.FEEDBACK_MAX_CHIPS),
  })
  .strict()
  .refine((v) => new Set(v.chips).size === v.chips.length)
  .refine((v) => v.met === 'YES' || (v.again === null && v.chips.length === 0))
  .refine((v) => !v.chips.length || (v.again !== null && v.again !== 'SKIP'));
export const exitSchema = z
  .object({
    version: z.number().int().nonnegative(),
    meaningfulConnection: z.boolean(),
    exitReason: z.enum(['taking-a-break', 'other']).optional(),
    followup30: z.boolean(),
    followup90: z.boolean(),
  })
  .strict()
  .refine((v) => v.meaningfulConnection || (!v.followup30 && !v.followup90));
export const followupSchema = z
  .object({
    answer: z.enum(['CONTINUING', 'ENDED', 'PREFER_NOT_TO_SAY']),
  })
  .strict();

/** P17: one morning-after prompt, using civil time rather than a fixed UTC offset. */
export function feedbackDue(start: Date, timezone: string = launch.timezone): Date {
  const p = zonedParts(start, timezone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1)).toISOString().slice(0, 10);
  const instant = localMeetingInstant(
    `${next}T${String(pilot.FEEDBACK_LOCAL_HOUR).padStart(2, '0')}:00`,
    timezone,
  );
  if (!instant) throw Error('Feedback civil time is ambiguous or unavailable');
  return new Date(instant);
}
/** P17: absence/abstention never becomes a no-show or a negative label. */
export function attendance(a: AttendanceAnswer, b: AttendanceAnswer) {
  const answers = [a, b].filter((x): x is 'YES' | 'NO' => x === 'YES' || x === 'NO');
  if (answers.length === 2 && answers[0] !== answers[1])
    return { provenance: 'DISPUTED' as const, attended: null };
  if (answers.length === 2)
    return { provenance: 'BOTH_REPORTED' as const, attended: answers[0] === 'YES' };
  if (answers.length === 1)
    return { provenance: 'ONE_REPORTED' as const, attended: answers[0] === 'YES' };
  return { provenance: 'UNKNOWN' as const, attended: null };
}
export function mutuallyPositive(a: Feedback | null, b: Feedback | null) {
  return a?.met === 'YES' && b?.met === 'YES' && a.again === 'YES' && b.again === 'YES';
}
/** At most two chips are offered in a single optional follow-up (P17). */
export function offeredChips(answer: ExperienceAnswer): readonly (typeof matchingChips)[number][] {
  if (answer === 'YES') return ['Easy conversation', 'Felt attraction'];
  if (answer === 'NOT_SURE') return ['Shared outlook', 'Different lifestyle'];
  if (answer === 'NO') return ['No spark', 'Different goals'];
  return [];
}
export function addCalendarMonths(date: Date, months: number) {
  const target = new Date(date);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return target;
}
