import { z } from 'zod';
import { retention } from '@meetwell/config/pilot';
import { addCalendarMonths } from './feedback';
export const holdCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('SET'),
      kind: z.enum(['report', 'integrity', 'appeal']),
      recordId: z.uuid(),
      version: z.number().int().nonnegative(),
      reason: z.string().trim().min(1).max(2000),
      until: z.iso.datetime(),
      review: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      action: z.enum(['RELEASE', 'REVIEW']),
      kind: z.enum(['report', 'integrity', 'appeal']),
      recordId: z.uuid(),
      version: z.number().int().nonnegative(),
    })
    .strict(),
]);
export function validHoldDates(until: Date, review: Date, now: Date) {
  return (
    until > now &&
    review > now &&
    review <= until &&
    review <= addCalendarMonths(now, retention.D9_REVIEW_MONTHS)
  );
}
