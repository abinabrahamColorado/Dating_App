import { it, expect } from 'vitest';
import fc from 'fast-check';
import {
  localMeetingInstant,
  venueEligible,
  rankVenues,
  calendarFile,
  publicVenue,
  sharedAvailability,
  defaultPlanningPreferences,
  canConfirmPlan,
  confirmedPlanState,
} from '../../packages/core/src/connections';
import { isDenied } from '../../packages/core/src/safety';
import { syntheticProfile } from '../fixtures/accounts';
import { meetingVenue, syntheticVenue } from '../fixtures/venues';
import { estimatedTravelMinutes } from '../../packages/core/src/explore';
import { pilot } from '../../packages/config/src/pilot';
const now = new Date('2026-11-04T12:00:00Z'),
  time = { start: '2026-11-05T16:00:00Z', minutes: 30 };
const venue = meetingVenue({ ...syntheticVenue(), reviewExpiresAt: '2027-01-01T00:00:00Z' });
venue.details.reviewDate = '2026-10-01';
it('I-09 overnight meetings require every occupied minute to be permitted on both days', () => {
  const time = { start: '2026-11-06T04:45:00Z', minutes: 30 }; // Thursday 23:45 in New York.
  expect(
    venueEligible(
      venue,
      syntheticProfile,
      syntheticProfile,
      [24, 24],
      [defaultPlanningPreferences, defaultPlanningPreferences],
      time,
      now,
    ),
  ).toBe(true);
  expect(
    venueEligible(
      { ...venue, details: { ...venue.details, hours: [{ day: 4, start: 0, end: 1440 }] } },
      syntheticProfile,
      syntheticProfile,
      [24, 24],
      [defaultPlanningPreferences, defaultPlanningPreferences],
      time,
      now,
    ),
  ).toBe(false);
});
it('I-09 local scheduling rejects daylight-saving gaps and ambiguous folds without silently moving consent', () => {
  expect(localMeetingInstant('2027-03-14T02:30')).toBeNull();
  expect(localMeetingInstant('2027-11-07T01:30')).toBeNull();
  expect(localMeetingInstant('2027-03-14T03:30')).toBe('2027-03-14T07:30:00.000Z');
  expect(localMeetingInstant('2027-02-30T12:00')).toBeNull();
});
it('I-02 I-09 venues satisfy both members access, cost, activity, hours, review expiry and alcohol boundaries', () => {
  const allows = (v = venue, p = defaultPlanningPreferences, ages = [24, 24]) =>
    venueEligible(
      v,
      syntheticProfile,
      syntheticProfile,
      ages,
      [defaultPlanningPreferences, p],
      time,
      now,
    );
  expect(allows()).toBe(true);
  for (const v of [
    { ...venue, disabled: true },
    { ...venue, approved: false },
    { ...venue, reviewExpiresAt: time.start },
    { ...venue, details: { ...venue.details, costBand: 1 } },
    { ...venue, details: { ...venue.details, hours: [] } },
    { ...venue, details: { ...venue.details, alcoholFree: false } },
  ])
    expect(allows(v)).toBe(false);
  expect(
    allows(
      {
        ...venue,
        details: {
          ...venue.details,
          accessibility: { ...venue.details.accessibility, toilets: false },
        },
      },
      { ...defaultPlanningPreferences, accessibility: ['toilets'] },
    ),
  ).toBe(false);
  expect(
    allows(
      { ...venue, details: { ...venue.details, activities: ['meal'] } },
      { ...defaultPlanningPreferences, activities: ['walk'] },
    ),
  ).toBe(false);
  expect(
    venueEligible(
      { ...venue, alcoholPrimary: true },
      syntheticProfile,
      syntheticProfile,
      [20, 24],
      [
        { ...defaultPlanningPreferences, allowAlcoholPrimary: true },
        { ...defaultPlanningPreferences, allowAlcoholPrimary: true },
      ],
      time,
      now,
    ),
  ).toBe(false);
});
it('I-09 venue ranking minimizes worst travel plus imbalance, is stable under input permutation and never publishes origins', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.tuple(
          fc.double({ min: 40.7, max: 40.8, noNaN: true }),
          fc.double({ min: -74.02, max: -73.95, noNaN: true }),
        ),
        { minLength: 4, maxLength: 12 },
      ),
      (points) => {
        const list = points.map((p, i) => ({
            ...venue,
            id: String(i).padStart(3, '0'),
            centroid: p,
          })),
          b = { ...syntheticProfile, areaId: 'upper-east-side' as const };
        const rank = rankVenues(list, syntheticProfile, b),
          cost = (v: typeof venue) => {
            const a = estimatedTravelMinutes(syntheticProfile, v),
              z = estimatedTravelMinutes(b, v);
            return Math.max(a, z) + pilot.VENUE_IMBALANCE_LAMBDA * Math.abs(a - z);
          };
        expect(rank).toHaveLength(3);
        expect(rank.map((v) => v.id)).toEqual(
          rankVenues([...list].reverse(), syntheticProfile, b).map((v) => v.id),
        );
        expect(rank.map(cost)).toEqual(
          list
            .map(cost)
            .sort((a, b) => a - b)
            .slice(0, 3),
        );
        expect(publicVenue(rank[0]!)).not.toHaveProperty('centroid');
      },
    ),
  );
});
it('I-09 shared windows intersect explicit boundaries and never require a two-hour meeting', () => {
  const a = {
      ...syntheticProfile,
      availability: { flexible: false, windows: [{ day: 4, start: 600, end: 660 }] },
    },
    b = { ...a, availability: { flexible: false, windows: [{ day: 4, start: 630, end: 690 }] } };
  expect(sharedAvailability(a, b, now).windows[0]).toEqual({
    start: '2026-11-05T15:30:00.000Z',
    end: '2026-11-05T16:00:00.000Z',
  });
  expect(sharedAvailability(syntheticProfile, syntheticProfile, now)).toEqual({
    flexible: true,
    windows: [],
  });
});
it('I-09 confirmations cannot cross revisions, and calendar text cannot inject an event or participant data', () => {
  expect(canConfirmPlan('PROPOSED', 2, 1)).toBe(false);
  expect(canConfirmPlan('INVALIDATED', 1, 1)).toBe(false);
  expect(confirmedPlanState(1)).toBe('PROPOSED');
  expect(confirmedPlanState(2)).toBe('CONFIRMED');
  const ics = calendarFile(
    'synthetic',
    publicVenue({ ...venue, name: 'Cafe\r\nATTENDEE:person@synthetic.invalid' }),
    time,
  );
  expect(ics).not.toContain('\r\nATTENDEE:');
  expect(ics).toContain('DTSTART:20261105T160000Z');
  expect(ics).toContain('DTEND:20261105T163000Z');
});
it('I-04 I-13 paused connection messaging requires the existing explicit keep-chats choice and never enables discovery', () => {
  const a = {
      id: 'a',
      state: 'ACTIVE' as const,
      deleted: false,
      restricted: false,
      blocksOther: false,
    },
    b = { ...a, id: 'b', state: 'PAUSED' as const, pauseChat: true };
  expect(isDenied(a, b)).toBe(true);
  expect(isDenied(a, b, 'CONNECTION')).toBe(false);
  expect(isDenied(a, { ...b, pauseChat: false }, 'CONNECTION')).toBe(true);
  expect(isDenied(a, { ...b, blocksOther: true }, 'CONNECTION')).toBe(true);
});
