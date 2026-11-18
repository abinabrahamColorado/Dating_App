import { expect, it } from 'vitest';
import fc from 'fast-check';
import {
  feedbackSchema,
  attendance,
  feedbackDue,
  offeredChips,
  addCalendarMonths,
  mutuallyPositive,
} from '../../packages/core/src/feedback';
import {
  cohortMetrics,
  exposureGini,
  safeCells,
  publicMetrics,
  type MetricInput,
} from '../../packages/core/src/metrics';
import { validHoldDates } from '../../packages/core/src/legal-hold';
import { readinessValid, readinessExpiry } from '../../packages/core/src/readiness';
import { retentionCutoffs, deletionDeadline } from '../../packages/core/src/retention';
const yes = { met: 'YES' as const, again: 'YES' as const, chips: [] };
it('I-10 P17 feedback stays categorical and optional; abstention is never a no-show', () => {
  expect(attendance(null, null)).toEqual({ provenance: 'UNKNOWN', attended: null });
  expect(attendance('YES', null)).toEqual({ provenance: 'ONE_REPORTED', attended: true });
  expect(attendance('YES', 'NO')).toEqual({ provenance: 'DISPUTED', attended: null });
  expect(attendance('NO', 'NO')).toEqual({ provenance: 'BOTH_REPORTED', attended: false });
  expect(feedbackSchema.parse({ met: 'PREFER_NOT_TO_SAY', again: null, chips: [] })).toBeDefined();
  expect(feedbackSchema.safeParse({ met: 'NO', again: 'YES', chips: [] }).success).toBe(false);
  expect(
    feedbackSchema.safeParse({
      ...yes,
      chips: ['No spark', 'Different goals', 'Different lifestyle'],
    }).success,
  ).toBe(false);
  for (const answer of ['YES', 'NO', 'NOT_SURE', 'SKIP', null] as const)
    expect(offeredChips(answer).length).toBeLessThanOrEqual(2);
  expect(mutuallyPositive(yes, null)).toBe(false);
  // No invitation/communication signal exists in this function's result.
  expect(mutuallyPositive(yes, yes)).toBe(true);
});
it('I-10 I-18 P17/P22 morning-after uses local civil time across DST and retention uses calendar months', () => {
  expect(feedbackDue(new Date('2026-03-07T23:00:00Z')).toISOString()).toBe(
    '2026-03-08T14:00:00.000Z',
  );
  expect(feedbackDue(new Date('2026-10-31T23:00:00Z')).toISOString()).toBe(
    '2026-11-01T15:00:00.000Z',
  );
  expect(addCalendarMonths(new Date('2024-02-29T12:00:00Z'), 24).toISOString()).toBe(
    '2026-02-28T12:00:00.000Z',
  );
});
it('I-10 P26 fixed-cohort metrics count distinct members, preserve unknown/disputed outcomes and bound time', () => {
  const input: MetricInput = {
    denominator: 20,
    startedAt: '2026-01-01T00:00:00Z',
    asOf: '2026-02-01T00:00:00Z',
    members: Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      offeredWithin14: i < 16,
      unservedReason: 'zero eligible supply',
      exposures: 1,
      activeSeconds: i < 2 ? 600 : null,
    })),
    meetings: [
      { id: '1', low: '0', high: '1', at: '2026-01-02T00:00:00Z', a: yes, b: yes },
      { id: '2', low: '0', high: '1', at: '2026-01-03T00:00:00Z', a: yes, b: yes },
      { id: '3', low: '2', high: '3', at: '2026-01-04T00:00:00Z', a: yes, b: null },
      {
        id: '4',
        low: '4',
        high: '5',
        at: '2026-01-04T00:00:00Z',
        a: yes,
        b: { met: 'NO', again: null, chips: [] },
      },
      { id: '5', low: '6', high: '7', at: '2026-01-04T00:00:00Z', a: null, b: null },
      { id: '6', low: '8', high: '9', at: '2026-01-30T00:00:00Z', a: yes, b: yes },
    ],
    secondReports: [],
    successes: 0,
    followups: [{ day: 30, consented: 4, continuing: 1, ended: 1, abstained: 1 }],
  };
  const m = cohortMetrics(input);
  expect(m.primary).toMatchObject({
    numerator: 2,
    denominator: 20,
    per100: 10,
    bounds: { lower: 2, upper: 20 },
    completeness: { both: 2, one: 2, neither: 14, contradictory: 2 },
  });
  expect(m.followThrough).toEqual({
    numerator: 2,
    denominator: 5,
    oneReportedAttended: 1,
    completeness: { both: 2, one: 1, neither: 1, contradictory: 1 },
  });
  expect(m.secondMeetings).toMatchObject({
    numerator: 2,
    denominator: 20,
    completeness: { both: 2, one: 0, neither: 18, contradictory: 0 },
  });
  expect(m.coverage).toMatchObject({ numerator: 16, denominator: 20, mature: true });
  expect(m.attention.attended).toMatchObject({
    median: 5,
    p90: 5,
    measuredMembers: 2,
    eligibleMembers: 2,
    totalMinutes: 20,
    meetingParticipations: 4,
  });
  expect(m.exposure.gini).toBe(0);
  expect(m.exposure.topDecileShare).toBe(0.1);
  expect(m.followups[0]!.unknown).toBe(1);
  expect(cohortMetrics({ ...input, members: input.members.slice(0, 18) }).primary.denominator).toBe(
    20,
  );
  expect(safeCells([0, 10, 30])).toBe(true);
  expect(safeCells([1, 19])).toBe(false);
  const published = publicMetrics(input);
  expect(published.primary).toBeNull();
  expect(published.coverage).toBeNull();
  expect(published.gates.every((g) => g.result === 'FAIL')).toBe(true);
});
it('I-18 I-20 retention and readiness reviews are explicit, bounded and never imply launch approval', () => {
  const now = new Date('2026-02-28T12:00:00Z');
  expect(deletionDeadline(now).toISOString()).toBe('2026-03-30T12:00:00.000Z');
  expect(retentionCutoffs(now).safety.toISOString()).toBe('2024-02-28T12:00:00.000Z');
  expect(validHoldDates(new Date('2027-03-01Z'), new Date('2027-03-01Z'), now)).toBe(false);
  expect(validHoldDates(new Date('2027-03-01Z'), new Date('2026-08-01Z'), now)).toBe(true);
  expect(readinessValid({}, 'OPERATIONS', now.toISOString())).toBe(false);
  const reviews = { OPERATIONS: { passed: true, expiresAt: readinessExpiry(now).toISOString() } };
  expect(readinessValid(reviews, 'OPERATIONS', now.toISOString())).toBe(true);
  expect(readinessValid(reviews, 'OPERATIONS', '2026-03-31T00:00:00Z')).toBe(false);
});
it('I-10 P26 property: missing responses never manufacture mutually positive outcomes or observed attendance', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 100 }),
      (exposures) => {
        const members = exposures.map((exposures, i) => ({
          id: String(i),
          exposures,
          offeredWithin14: false,
          unservedReason: 'not assessed',
          activeSeconds: null,
        }));
        const m = cohortMetrics({
          denominator: members.length,
          startedAt: '2026-01-01T00:00:00Z',
          asOf: '2026-02-01T00:00:00Z',
          members,
          meetings: [],
          secondReports: [],
          successes: 0,
          followups: [],
        });
        expect(m.primary.numerator).toBe(0);
        expect(m.followThrough.numerator).toBe(0);
        expect(m.primary.completeness.neither).toBe(members.length);
        const g = exposureGini(exposures);
        if (g !== null) {
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThan(1);
        }
      },
    ),
  );
});
