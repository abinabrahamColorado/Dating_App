import { z } from 'zod';
import { launch, pilot } from '@meetwell/config/pilot';
import type { Profile } from './accounts';
import { estimatedTravelMinutes, type Venue } from './explore';

export const activities = ['conversation', 'coffee', 'walk', 'meal'] as const;
export const accessFeatures = ['entrance', 'seating', 'toilets'] as const;
const shortText = z.string().trim().min(1).max(1000);
export const hoursSchema = z
  .array(
    z
      .object({
        day: z.number().int().min(0).max(6),
        start: z.number().int().min(0).max(1439),
        end: z.number().int().min(1).max(1440),
      })
      .strict()
      .refine((w) => w.end > w.start),
  )
  .max(28);
export const venueDetailsSchema = z
  .object({
    address: shortText,
    entrance: shortText,
    category: z.enum(['cafe', 'library', 'student-union', 'mall', 'public-park', 'civic-space']),
    permittedMeetingArea: shortText,
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    hours: hoursSchema,
    liveSessionEligible: z.boolean(),
    accessibility: z
      .object({
        entrance: z.boolean(),
        seating: z.boolean(),
        toilets: z.boolean(),
        details: shortText,
      })
      .strict(),
    seating: z.boolean(),
    noPurchase: z.boolean(),
    costBand: z.number().int().min(0).max(3),
    alcoholFree: z.boolean(),
    staffed: z.boolean(),
    activities: z.array(z.enum(activities)).min(1).max(4),
    transit: shortText,
    emergencyExitNotes: shortText,
    checks: shortText,
    reviewDate: z.iso.date(),
  })
  .strict();
export type VenueDetails = z.infer<typeof venueDetailsSchema>;
export const venueWriteSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(120),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    approved: z.boolean(),
    humanReviewed: z.boolean(),
    alcoholPrimary: z.boolean(),
    reviewExpiresAt: z.iso.datetime({ offset: true }),
    details: venueDetailsSchema,
    partnered: z.boolean(),
    partnerContact: z.string().trim().max(1000),
    trainingStatus: z.string().trim().max(1000),
    complaintHistory: z.string().trim().max(4000),
  })
  .strict()
  .refine(
    (v) =>
      !v.approved ||
      (v.humanReviewed &&
        v.details.hours.length > 0 &&
        new Date(v.reviewExpiresAt) > new Date(v.details.reviewDate) &&
        (!v.partnered || (v.partnerContact.length > 0 && v.trainingStatus.length > 0)) &&
        (!v.alcoholPrimary || (v.details.alcoholFree && v.details.staffed))),
    'Complete the human venue review before approval.',
  );
export type VenueWrite = z.infer<typeof venueWriteSchema>;
export type MeetingVenue = Venue & {
  name: string;
  version: number;
  disabled: boolean;
  details: VenueDetails;
};
export const planningPreferencesSchema = z
  .object({
    maxCostBand: z.number().int().min(0).max(3),
    accessibility: z.array(z.enum(accessFeatures)).max(3),
    activities: z.array(z.enum(activities)).min(1).max(4),
    alcoholFree: z.boolean(),
    allowAlcoholPrimary: z.boolean(),
    noPurchase: z.boolean(),
  })
  .strict();
export type PlanningPreferences = z.infer<typeof planningPreferencesSchema>;
export const defaultPlanningPreferences: PlanningPreferences = {
  maxCostBand: 0,
  accessibility: [],
  activities: [...activities],
  alcoholFree: true,
  allowAlcoholPrimary: false,
  noPurchase: true,
};
export const meetingTimeSchema = z
  .object({
    start: z.iso.datetime({ offset: true }),
    minutes: z.number().int().min(pilot.PLAN_MIN_MINUTES).max(pilot.PLAN_MAX_MINUTES),
  })
  .strict();
export type MeetingTime = z.infer<typeof meetingTimeSchema>;
export const messageSchema = z
  .object({ text: z.string().trim().min(1).max(pilot.CHAT_MAX_CHARACTERS) })
  .strict();
export const planCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('PROPOSE'), optionsId: z.uuid(), venueId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('CHANGE'),
      planId: z.uuid(),
      version: z.number().int().nonnegative(),
      optionsId: z.uuid(),
      venueId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal('CONFIRM'),
      planId: z.uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.enum(['CANCEL', 'DECLINE']),
      planId: z.uuid(),
      version: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type PlanCommand = z.infer<typeof planCommandSchema>;
export type PlanState = 'PROPOSED' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED' | 'INVALIDATED';
export function canChangePlan(state: PlanState) {
  return ['PROPOSED', 'CONFIRMED', 'INVALIDATED'].includes(state);
}
export function canConfirmPlan(state: PlanState, revision: number, requested: number) {
  return ['PROPOSED', 'CONFIRMED'].includes(state) && revision === requested;
}
export function confirmedPlanState(confirmations: number): PlanState {
  return confirmations === 2 ? 'CONFIRMED' : 'PROPOSED';
}
export function suggestArchive(lastProgress: Date, now: Date) {
  return now.getTime() - lastProgress.getTime() >= pilot.ARCHIVE_SUGGEST_DAYS * 86400000;
}
function zonedFormatter(timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
export function zonedParts(instant: Date, timezone: string, formatter = zonedFormatter(timezone)) {
  const p = formatter.formatToParts(instant);
  const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    hour: n('hour'),
    minute: n('minute'),
  };
}
/** Local inputs must have exactly one instant. Reject DST gaps AND folds instead
 * of silently choosing a different time or one of two possible confirmations. */
export function localMeetingInstant(local: string, timezone = launch.timezone): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const guess = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(guess)) return null;
  const offsets = new Set<number>();
  for (let h = -36; h <= 36; h += 6) {
    const sample = new Date(guess + h * 3600000),
      p = zonedParts(sample, timezone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - sample.getTime());
  }
  const matches = [...offsets]
    .map((offset) => new Date(guess - offset))
    .filter((d) => {
      const p = zonedParts(d, timezone);
      return (
        `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` ===
        local
      );
    });
  return matches.length === 1 ? matches[0]!.toISOString() : null;
}
function withinHours(start: Date, end: Date, timezone: string, hours: z.infer<typeof hoursSchema>) {
  if (!(end > start) || end.getTime() - start.getTime() > pilot.PLAN_MAX_MINUTES * 60000)
    return false;
  const formatter = zonedFormatter(timezone);
  // Check every occupied civil minute, including both sides of midnight and
  // repeated DST minutes. Adjacent permitted windows may cover one meeting.
  for (let at = Math.floor(start.getTime() / 60000) * 60000; at < end.getTime(); at += 60000) {
    const p = zonedParts(new Date(at), timezone, formatter),
      day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
      minute = p.hour * 60 + p.minute;
    if (!hours.some((w) => w.day === day && w.start <= minute && w.end > minute)) return false;
  }
  return true;
}
export function timeFits(a: Profile, b: Profile, time: MeetingTime, now: Date) {
  const start = new Date(time.start),
    end = new Date(start.getTime() + time.minutes * 60000);
  return (
    start > now &&
    start.getTime() - now.getTime() <= pilot.AVAILABILITY_HORIZON_DAYS * 86400000 &&
    [a, b].every(
      (p) =>
        p.availability.flexible || withinHours(start, end, launch.timezone, p.availability.windows),
    )
  );
}
export function sharedAvailability(a: Profile, b: Profile, now: Date) {
  if (a.availability.flexible && b.availability.flexible) return { flexible: true, windows: [] };
  const today = zonedParts(now, launch.timezone),
    windows: { start: string; end: string }[] = [];
  for (let offset = 0; offset < pilot.AVAILABILITY_HORIZON_DAYS; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset)),
      day = date.getUTCDay(),
      key = date.toISOString().slice(0, 10);
    const of = (p: Profile) =>
      p.availability.flexible
        ? [{ day, start: 0, end: 1440 }]
        : p.availability.windows.filter((w) => w.day === day);
    for (const x of of(a))
      for (const y of of(b)) {
        const start = Math.max(x.start, y.start),
          end = Math.min(x.end, y.end);
        if (end <= start) continue;
        const at = (m: number) =>
          m === 1440
            ? `${new Date(date.getTime() + 86400000).toISOString().slice(0, 10)}T00:00`
            : `${key}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const from = localMeetingInstant(at(start)),
          to = localMeetingInstant(at(end));
        if (from && to && new Date(to) > now)
          windows.push({
            start: new Date(Math.max(new Date(from).getTime(), now.getTime())).toISOString(),
            end: to,
          });
      }
  }
  return { flexible: false, windows };
}
export function venueEligible(
  v: MeetingVenue,
  a: Profile,
  b: Profile,
  ages: readonly number[],
  preferences: readonly PlanningPreferences[],
  time: MeetingTime,
  now: Date,
) {
  const start = new Date(time.start),
    end = new Date(start.getTime() + time.minutes * 60000);
  return (
    v.approved &&
    !v.disabled &&
    new Date(v.reviewExpiresAt) > end &&
    new Date(v.details.reviewDate) <= now &&
    timeFits(a, b, time, now) &&
    withinHours(start, end, v.details.timezone, v.details.hours) &&
    (!v.alcoholPrimary ||
      (ages.every((age) => age >= pilot.ALCOHOL_PRIMARY_VENUE_MIN_AGE) &&
        v.details.alcoholFree &&
        v.details.staffed)) &&
    [a, b].every((p) => estimatedTravelMinutes(p, v) <= p.travelMinutes) &&
    preferences.every(
      (p) =>
        v.details.costBand <= p.maxCostBand &&
        p.accessibility.every((f) => v.details.accessibility[f]) &&
        (!p.alcoholFree || v.details.alcoholFree) &&
        (!p.noPurchase || v.details.noPurchase) &&
        (!v.alcoholPrimary || p.allowAlcoholPrimary),
    ) &&
    v.details.activities.some((activity) =>
      preferences.every((p) => p.activities.includes(activity)),
    )
  );
}
export function rankVenues(venues: MeetingVenue[], a: Profile, b: Profile) {
  const burden = (v: MeetingVenue) => {
    const x = estimatedTravelMinutes(a, v),
      y = estimatedTravelMinutes(b, v);
    return Math.max(x, y) + pilot.VENUE_IMBALANCE_LAMBDA * Math.abs(x - y);
  };
  return [...venues]
    .sort((x, y) => burden(x) - burden(y) || x.id.localeCompare(y.id))
    .slice(0, pilot.VENUE_SUGGESTIONS);
}
/** Only public venue fields. No member origins, travel scores or partner contacts. */
export function publicVenue(v: MeetingVenue) {
  return {
    id: v.id,
    name: v.name,
    version: v.version,
    reviewExpiresAt: v.reviewExpiresAt,
    alcoholPrimary: v.alcoholPrimary,
    ...v.details,
  };
}
export type PublicVenue = ReturnType<typeof publicVenue>;
export function calendarFile(id: string, venue: PublicVenue, time: MeetingTime) {
  const escape = (s: string) =>
    s
      .replaceAll('\\', '\\\\')
      .replaceAll('\r', '')
      .replaceAll('\n', '\\n')
      .replaceAll(';', '\\;')
      .replaceAll(',', '\\,');
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replaceAll('-', '')
      .replaceAll(':', '')
      .replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meetwell//Plans//EN',
    'BEGIN:VEVENT',
    `UID:${id}@meetwell.invalid`,
    `DTSTAMP:${stamp(new Date(time.start))}`,
    `DTSTART:${stamp(new Date(time.start))}`,
    `DTEND:${stamp(new Date(new Date(time.start).getTime() + time.minutes * 60000))}`,
    `SUMMARY:${escape(`Meet at ${venue.name}`)}`,
    `LOCATION:${escape(venue.address)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // RFC 5545 folding at UTF-8 octet boundaries, preserving complete code points.
  return (
    lines
      .map((line) => {
        let out = '',
          chunk = '',
          bytes = 0;
        for (const c of line) {
          const n = new TextEncoder().encode(c).length;
          if (bytes + n > 75) {
            out += `${chunk}\r\n`;
            chunk = ' ';
            bytes = 1;
          }
          chunk += c;
          bytes += n;
        }
        return out + chunk;
      })
      .join('\r\n') + '\r\n'
  );
}
