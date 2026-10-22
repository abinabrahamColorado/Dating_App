import { it, expect } from 'vitest';
import fc from 'fast-check';
import {
  allocate,
  eligible,
  feasibleEdges,
  statedFitHeuristic,
  weightedStatedShare,
  availabilityFeasible,
  estimatedTravelMinutes,
  exactSmallGraph,
  decisionOutcome,
  memberStatus,
  weekKey,
} from '../../packages/core/src/explore';
import { exploreMember, allPairs, syntheticVenue, exploreNow } from '../fixtures/explore';
it('I-02 I-04 all explicit gates are bilateral and no heuristic can override them', () => {
  const a = exploreMember('a'),
    b = exploreMember('b'),
    facts = allPairs([a, b])[0]!;
  const check = (x = a, y = b, f = facts) => eligible(x, y, exploreNow, f, [syntheticVenue]);
  expect(check()).toBe(true);
  for (const change of [
    { state: 'PAUSED' as const },
    { intent: 'FOCUS' as const },
    { restricted: true },
    { deleted: true },
    { complete: false },
    { approvedPhotos: 1 },
    { freeSlots: 0 },
    { remainingWeekly: 0 },
  ]) {
    expect(check({ ...a, ...change })).toBe(false);
    expect(check(a, { ...b, ...change })).toBe(false);
  }
  for (const id of ['a', 'b']) expect(check(a, b, { ...facts, blockedBy: [id] })).toBe(false);
  expect(check(a, b, { ...facts, hasHistory: true })).toBe(false);
  expect(check(a, { ...b, profile: { ...b.profile, smoking: 'yes' } })).toBe(false);
  expect(check({ ...a, preferences: { ...a.preferences, whoToMeet: ['woman'] } })).toBe(false);
  expect(check(a, { ...b, age: 17 })).toBe(false);
  expect(
    eligible(
      { ...a, freeSlots: 0 },
      { ...b, freeSlots: 0 },
      exploreNow,
      { ...facts, hasHistory: true },
      [syntheticVenue],
      'ACCEPTANCE',
    ),
  ).toBe(true);
});
it('I-02 travel uses public centroids and both budgets; expired/alcohol-primary venues fail protective gates', () => {
  const a = exploreMember('a'),
    b = exploreMember('b'),
    f = allPairs([a, b])[0]!;
  expect(estimatedTravelMinutes(a.profile, syntheticVenue)).toBe(0);
  expect(eligible(a, b, exploreNow, f, [{ ...syntheticVenue, approved: false }])).toBe(false);
  expect(
    eligible(a, b, exploreNow, f, [{ ...syntheticVenue, reviewExpiresAt: '2020-01-01' }]),
  ).toBe(false);
  expect(
    eligible({ ...a, age: 20 }, b, exploreNow, f, [{ ...syntheticVenue, alcoholPrimary: true }]),
  ).toBe(false);
  expect(
    eligible(
      a,
      { ...b, profile: { ...b.profile, areaId: 'harlem', travelMinutes: 1, transport: 'walk' } },
      exploreNow,
      f,
      [syntheticVenue],
    ),
  ).toBe(false);
});
it('I-02 availability accepts real overlap or explicit flexibility without inventing a two-hour minimum', () => {
  const a = exploreMember('a').profile,
    b = structuredClone(a);
  a.availability = { flexible: false, windows: [{ day: 3, start: 900, end: 910 }] };
  b.availability = { flexible: false, windows: [{ day: 3, start: 905, end: 915 }] };
  expect(availabilityFeasible(a, b, exploreNow)).toBe(true);
  b.availability.windows = [{ day: 3, start: 910, end: 920 }];
  expect(availabilityFeasible(a, b, exploreNow)).toBe(false);
  b.availability = { flexible: true, windows: [] };
  expect(availabilityFeasible(a, b, exploreNow)).toBe(true);
  a.availability.windows = [];
  expect(availabilityFeasible(a, b, exploreNow)).toBe(false);
  a.availability.flexible = true;
  expect(availabilityFeasible(a, b, exploreNow)).toBe(true);
  expect(weekKey(new Date('2026-10-19T01:00:00Z'))).toBe('2026-10-12'); // Sunday in NYC.
});
it('I-03 I-15 statedFitHeuristic excludes unknown attributes and weights only stated flexible preferences', () => {
  expect(weightedStatedShare([])).toBe(1);
  expect(
    weightedStatedShare([
      { strength: 'STRONG', matches: true },
      { strength: 'SOFT', matches: false },
      { strength: 'STRONG', matches: null },
    ]),
  ).toBeCloseTo(2 / 3);
  const a = exploreMember('a'),
    b = exploreMember('b');
  expect(statedFitHeuristic(a, b)).toBe(1);
  a.preferences.smoking.setting = 'STRONG';
  b.profile.smoking = 'yes';
  expect(statedFitHeuristic(a, b)).toBe(0);
  b.profile.smoking = 'not-stated';
  expect(statedFitHeuristic(a, b)).toBe(1);
});
it('I-02 I-05 I-06 I-15 allocator properties: legal unique edges, budgets, exact q normalization and seeded replay', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 2, maxLength: 8 }),
      fc.string({ maxLength: 30 }),
      fc.array(fc.boolean(), { minLength: 28, maxLength: 28 }),
      (caps, seed, denials) => {
        const ms = caps.map((cap, i) => exploreMember(String(i), cap));
        const facts = allPairs(ms).map((f, i) => ({ ...f, blockedBy: denials[i] ? [f.u] : [] }));
        const result = allocate(ms, [...facts, ...facts], [syntheticVenue], exploreNow, seed);
        expect(result).toEqual(allocate(ms, facts, [syntheticVenue], exploreNow, seed));
        expect(new Set(result.steps.map((s) => s.edge.key)).size).toBe(result.steps.length);
        for (const m of ms)
          expect(
            result.steps.filter((s) => s.edge.u === m.id || s.edge.v === m.id).length,
          ).toBeLessThanOrEqual(Math.min(m.freeSlots, m.remainingWeekly));
        for (const step of result.steps) {
          expect(step.probabilities.reduce((n, p) => n + p.q, 0)).toBeCloseTo(1, 12);
          expect(step.probabilities.find((p) => p.key === step.edge.key)!.q).toBe(step.q);
          const f = facts.find((f) => f.u === step.edge.u && f.v === step.edge.v)!;
          expect(
            eligible(
              ms.find((m) => m.id === f.u)!,
              ms.find((m) => m.id === f.v)!,
              exploreNow,
              f,
              [syntheticVenue],
            ),
          ).toBe(true);
        }
      },
    ),
  );
});
it('I-16 truthful unmet-demand reasons never produce an ineligible filler', () => {
  const a = exploreMember('a'),
    b = { ...exploreMember('b'), state: 'PAUSED' as const };
  expect(allocate([a, b], allPairs([a, b]), [syntheticVenue], exploreNow, 'x')).toMatchObject({
    steps: [],
    unserved: [
      { memberId: 'a', reason: 'zero eligible supply' },
      { memberId: 'b', reason: 'paused' },
    ],
  });
  expect(
    allocate([a, exploreMember('b')], [], [syntheticVenue], exploreNow, 'x').unserved.every(
      (u) => u.reason === 'retrieval miss',
    ),
  ).toBe(true);
  expect(
    allocate([{ ...a, freeSlots: 0 }], [], [syntheticVenue], exploreNow, 'x').unserved[0]!.reason,
  ).toBe('capacity');
});
it('I-06 P16 exact offline solver measures the small-graph cardinality gap', () => {
  const ms = Array.from({ length: 5 }, (_, i) => exploreMember(String(i), 1));
  const edges = feasibleEdges(ms, allPairs(ms), [syntheticVenue], exploreNow);
  const exact = exactSmallGraph(edges, new Map(ms.map((m) => [m.id, 1])));
  expect(exact.edges).toHaveLength(2);
  expect(
    allocate(ms, allPairs(ms), [syntheticVenue], exploreNow, 'fixed', 0).steps.length,
  ).toBeLessThanOrEqual(exact.edges.length);
});
it('I-07 I-08 decisions are blind until mutual, expiry stays distinct and cannot turn into a pass', () => {
  const deadline = new Date(exploreNow.getTime() + 1000);
  expect(decisionOutcome('PROPOSED', deadline, exploreNow, 'ACCEPT', 'UNDECIDED')).toBe('PROPOSED');
  expect(decisionOutcome('PROPOSED', deadline, exploreNow, 'ACCEPT', 'ACCEPT')).toBe('MUTUAL');
  expect(decisionOutcome('PROPOSED', deadline, deadline, 'PASS', 'UNDECIDED')).toBe('EXPIRED');
  expect(memberStatus('PASSED', 'UNDECIDED')).toBe(memberStatus('BLOCKED', 'UNDECIDED'));
  expect(memberStatus('EXPIRED', 'UNDECIDED')).toBe('EXPIRED');
});
