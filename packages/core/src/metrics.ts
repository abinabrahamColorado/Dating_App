import { pilot } from '@meetwell/config/pilot';
import { attendance, mutuallyPositive, type Feedback } from './feedback';
import { readinessValid, type Readiness } from './readiness';

export type Completeness = { both: number; one: number; neither: number; contradictory: number };
export type MetricMember = {
  id: string;
  offeredWithin14: boolean;
  unservedReason: string;
  exposures: number;
  activeSeconds: number | null;
};
export type MetricMeeting = {
  id: string;
  low: string;
  high: string;
  at: string;
  a: Feedback | null;
  b: Feedback | null;
};
export type MetricInput = {
  denominator: number;
  startedAt: string;
  asOf: string;
  members: MetricMember[];
  meetings: MetricMeeting[];
  secondReports: {
    low: string;
    high: string;
    both: boolean;
    at: string;
    a?: boolean | null;
    b?: boolean | null;
  }[];
  successes: number;
  exitObserved?: number;
  followups: {
    day: number;
    consented: number;
    continuing: number;
    ended: number;
    abstained: number;
    withdrawn?: number;
    not_due?: number;
  }[];
};
const emptyCompleteness = (): Completeness => ({ both: 0, one: 0, neither: 0, contradictory: 0 });
export function exposureGini(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    total = sorted.reduce((a, b) => a + b, 0);
  return !total || !sorted.length
    ? null
    : sorted.reduce((sum, x, i) => sum + (2 * (i + 1) - sorted.length - 1) * x, 0) /
        (sorted.length * total);
}
function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]! : null;
}
/** P26 fixed, disjoint enrollment cohorts; never replace their denominator with activity. */
export function cohortMetrics(input: MetricInput, settings: typeof pilot = pilot) {
  const ids = new Set(input.members.map((m) => m.id));
  if (ids.size !== input.members.length || input.denominator < ids.size || input.denominator < 0)
    throw Error('Invalid fixed cohort');
  const start = Date.parse(input.startedAt),
    end = start + settings.OUTCOME_HORIZON_DAYS * 86400000;
  const observedUntil = Math.min(Date.parse(input.asOf), end);
  const meetings = input.meetings.filter(
    (m) =>
      Date.parse(m.at) >= start &&
      Date.parse(m.at) < observedUntil &&
      (ids.has(m.low) || ids.has(m.high)),
  );
  const positive = new Set<string>(),
    second = new Set<string>();
  const attendedByMember = new Map<string, number>(),
    positiveByMember = new Map<string, number>();
  const pairMeetings = new Map<string, number>(),
    completeness = emptyCompleteness();
  let attended = 0,
    oneAttended = 0;
  for (const m of meetings) {
    const evidence = attendance(m.a?.met ?? null, m.b?.met ?? null);
    const count = [m.a, m.b].filter((f) => f && f.met !== 'PREFER_NOT_TO_SAY').length;
    if (evidence.provenance === 'DISPUTED') completeness.contradictory++;
    else if (count === 2) completeness.both++;
    else if (count === 1) completeness.one++;
    else completeness.neither++;
    if (evidence.attended && evidence.provenance === 'ONE_REPORTED') oneAttended++;
    if (evidence.attended && evidence.provenance === 'BOTH_REPORTED') {
      attended++;
      const pair = [m.low, m.high].sort().join(':');
      pairMeetings.set(pair, (pairMeetings.get(pair) ?? 0) + 1);
      for (const id of [m.low, m.high].filter((id) => ids.has(id)))
        attendedByMember.set(id, (attendedByMember.get(id) ?? 0) + 1);
      if (pairMeetings.get(pair)! >= 2)
        for (const id of [m.low, m.high].filter((id) => ids.has(id))) second.add(id);
    }
    if (mutuallyPositive(m.a, m.b))
      for (const id of [m.low, m.high].filter((id) => ids.has(id))) {
        positive.add(id);
        positiveByMember.set(id, (positiveByMember.get(id) ?? 0) + 1);
      }
  }
  for (const r of input.secondReports)
    if (r.both && Date.parse(r.at) >= start && Date.parse(r.at) < observedUntil)
      for (const id of [r.low, r.high].filter((id) => ids.has(id))) second.add(id);
  const memberCompleteness = emptyCompleteness();
  for (const member of input.members) {
    const ownMeetings = meetings.filter((m) => m.low === member.id || m.high === member.id);
    if (
      ownMeetings.some(
        (m) => attendance(m.a?.met ?? null, m.b?.met ?? null).provenance === 'DISPUTED',
      )
    )
      memberCompleteness.contradictory++;
    else if (
      ownMeetings.some((m) =>
        [m.a, m.b].every(
          (f) => f && (f.met === 'NO' || (f.met === 'YES' && f.again && f.again !== 'SKIP')),
        ),
      )
    )
      memberCompleteness.both++;
    else if (ownMeetings.some((m) => [m.a, m.b].some((f) => f && f.met !== 'PREFER_NOT_TO_SAY')))
      memberCompleteness.one++;
    else memberCompleteness.neither++;
  }
  memberCompleteness.neither += input.denominator - ids.size;
  const unresolved =
    input.members.filter((member) => {
      if (positive.has(member.id)) return false;
      const own = meetings.filter((m) => m.low === member.id || m.high === member.id);
      return (
        !own.length ||
        own.some(
          (m) =>
            attendance(m.a?.met ?? null, m.b?.met ?? null).provenance === 'DISPUTED' ||
            [m.a, m.b].some(
              (f) =>
                !f ||
                f.met === 'PREFER_NOT_TO_SAY' ||
                (f.met === 'YES' && (!f.again || f.again === 'SKIP')),
            ),
        )
      );
    }).length +
    input.denominator -
    ids.size;
  const secondCompleteness = emptyCompleteness();
  for (const id of ids) {
    const rows = input.secondReports.filter(
      (r) =>
        [r.low, r.high].includes(id) &&
        Date.parse(r.at) >= start &&
        Date.parse(r.at) < observedUntil,
    );
    if (rows.some((r) => r.a != null && r.b != null && r.a !== r.b))
      secondCompleteness.contradictory++;
    else if (second.has(id) || rows.some((r) => r.a != null && r.b != null))
      secondCompleteness.both++;
    else if (rows.some((r) => r.a != null || r.b != null)) secondCompleteness.one++;
    else secondCompleteness.neither++;
  }
  secondCompleteness.neither += input.denominator - ids.size;
  const covered = input.members.filter((m) => m.offeredWithin14).length;
  const reasons: Record<string, number> = {};
  for (const m of input.members.filter((m) => !m.offeredWithin14))
    reasons[m.unservedReason] = (reasons[m.unservedReason] ?? 0) + 1;
  if (input.denominator > ids.size) reasons['withdrawn or erased'] = input.denominator - ids.size;
  const exposures = input.members.map((m) => m.exposures),
    total = exposures.reduce((a, b) => a + b, 0);
  const attention = (counts: Map<string, number>) => {
    const people = input.members.filter(
      (m) => m.activeSeconds !== null && (counts.get(m.id) ?? 0) > 0,
    );
    const costs = people.map((m) => m.activeSeconds! / 60 / counts.get(m.id)!);
    return {
      median: quantile(costs, 0.5),
      p90: quantile(costs, 0.9),
      measuredMembers: people.length,
      eligibleMembers: counts.size,
      totalMinutes: people.reduce((n, m) => n + m.activeSeconds! / 60, 0),
      meetingParticipations: people.reduce((n, m) => n + counts.get(m.id)!, 0),
    };
  };
  return {
    denominator: input.denominator,
    mature: Date.parse(input.asOf) >= end,
    primary: {
      numerator: positive.size,
      denominator: input.denominator,
      per100: input.denominator
        ? (positive.size / input.denominator) * settings.METRIC_RATE_DENOMINATOR
        : null,
      completeness: memberCompleteness,
      bounds: {
        lower: positive.size,
        upper: positive.size + unresolved,
        interpretation:
          'Sensitivity bound: unresolved members could contribute zero or one positive. Not an estimate of unreported meetings.',
      },
    },
    followThrough: {
      numerator: attended,
      denominator: meetings.length,
      oneReportedAttended: oneAttended,
      completeness,
    },
    secondMeetings: {
      numerator: second.size,
      denominator: input.denominator,
      completeness: secondCompleteness,
    },
    coverage: {
      numerator: covered,
      denominator: input.denominator,
      mature: Date.parse(input.asOf) >= start + settings.COVERAGE_HORIZON_DAYS * 86400000,
      reasons,
    },
    attention: { attended: attention(attendedByMember), positive: attention(positiveByMember) },
    exposure: {
      gini: exposureGini(exposures),
      topDecileShare: total
        ? [...exposures]
            .sort((a, b) => b - a)
            .slice(0, Math.ceil(exposures.length / 10))
            .reduce((a, b) => a + b, 0) / total
        : null,
      members: exposures.length,
      total,
    },
    successes: {
      numerator: input.successes,
      denominator: input.denominator,
      completeness: {
        both: 0,
        one: input.exitObserved ?? input.successes,
        neither: input.denominator - (input.exitObserved ?? input.successes),
        contradictory: 0,
      },
    },
    followups: input.followups.map((f) => ({
      ...f,
      unknown: f.consented - f.continuing - f.ended - f.abstained,
      completeness: {
        both: 0,
        one: f.continuing + f.ended,
        neither: f.consented - f.continuing - f.ended,
        contradictory: 0,
      },
    })),
  };
}
/** No complementary small-cell disclosure through totals: suppress the whole
 * metric group when any nonzero component has insufficient support. */
export function safeCells(values: number[]) {
  return values.every((n) => n === 0 || n >= pilot.SMALL_CELL_MIN_MEMBERS);
}

export function publicMetrics(
  input: MetricInput,
  thresholds: typeof pilot = pilot,
  reviews: Readiness = {},
) {
  const m = cohortMetrics(input, thresholds),
    k = thresholds.SMALL_CELL_MIN_MEMBERS;
  const enough = (n: number, cells: number[]) => n >= k && cells.every((v) => v === 0 || v >= k);
  const paired = <T extends { numerator: number; denominator: number; completeness: Completeness }>(
    value: T,
  ) =>
    enough(value.denominator, [
      value.numerator,
      value.denominator - value.numerator,
      ...Object.values(value.completeness),
    ])
      ? value
      : null;
  const primary = enough(m.primary.denominator, [
      m.primary.bounds.upper,
      m.primary.denominator - m.primary.bounds.upper,
      m.primary.bounds.upper - m.primary.bounds.lower,
    ])
      ? paired(m.primary)
      : null,
    followThrough = paired(m.followThrough),
    secondMeetings = paired(m.secondMeetings),
    successes = paired(m.successes);
  const coverage = enough(m.coverage.denominator, [
    m.coverage.numerator,
    m.coverage.denominator - m.coverage.numerator,
    ...Object.values(m.coverage.reasons),
  ])
    ? {
        ...m.coverage,
        completeness: {
          both: 0,
          one: input.members.length,
          neither: input.denominator - input.members.length,
          contradictory: 0,
        },
        observation:
          'System-observed offers; one means a retained member record, not a partner response.',
      }
    : null;
  const attention = Object.fromEntries(
    Object.entries(m.attention).map(([name, v]) => [
      name,
      enough(v.measuredMembers, [v.eligibleMembers - v.measuredMembers])
        ? {
            ...v,
            denominator: v.meetingParticipations,
            completeness: {
              both: 0,
              one: v.measuredMembers,
              neither: v.eligibleMembers - v.measuredMembers,
              contradictory: 0,
            },
            observation:
              'Optional active-time measurement; one means one consenting member. Costs are per member meeting-participation.',
          }
        : null,
    ]),
  );
  const exposure = enough(input.denominator, [
    input.members.length,
    input.denominator - input.members.length,
  ])
    ? {
        ...m.exposure,
        denominator: input.denominator,
        completeness: {
          both: 0,
          one: input.members.length,
          neither: input.denominator - input.members.length,
          contradictory: 0,
        },
        observation: 'System-observed exposures; erased rows remain unknown.',
      }
    : null;
  const followups = m.followups.map((f) =>
    enough(f.consented, [
      f.continuing,
      f.ended,
      f.abstained,
      f.unknown,
      f.withdrawn ?? 0,
      f.not_due ?? 0,
    ])
      ? { ...f, denominator: f.consented }
      : { day: f.day, suppressed: true },
  );
  const gate = (name: string, pass: boolean, threshold: string, reason: string) => ({
    name,
    result: pass ? 'PASS' : 'FAIL',
    threshold,
    reason,
  });
  return {
    asOf: input.asOf,
    startedAt: input.startedAt,
    mature: m.mature,
    denominator: input.denominator >= k ? input.denominator : null,
    primary,
    followThrough,
    secondMeetings,
    coverage,
    attention,
    exposure,
    successes,
    followups,
    gates: [
      gate(
        'Consent/privacy',
        readinessValid(reviews, 'CONSENT_PRIVACY', input.asOf),
        'No known critical defect; adversarial and race tests pass',
        'Requires a current audited review. CI alone is not a launch approval.',
      ),
      gate(
        'Operational readiness',
        readinessValid(reviews, 'OPERATIONS', input.asOf),
        'Named owner, staffed windows, reviewed venues, playbooks, demonstrated deletion',
        'Hosting, custody and staffed operating commitments remain founder launch decisions.',
      ),
      gate(
        'Supply feasibility',
        !!coverage &&
          coverage.mature &&
          coverage.numerator / coverage.denominator >= thresholds.COVERAGE_GATE,
        `${thresholds.COVERAGE_GATE * 100}% within ${thresholds.COVERAGE_HORIZON_DAYS} days`,
        coverage
          ? 'Fixed cohort; reasons and unknowns shown.'
          : 'Insufficient publishable evidence.',
      ),
      gate(
        'Meeting follow-through',
        !!followThrough &&
          m.mature &&
          followThrough.denominator > 0 &&
          followThrough.numerator / followThrough.denominator >= thresholds.FOLLOW_THROUGH_GATE,
        `${thresholds.FOLLOW_THROUGH_GATE * 100}% both-reported attended / confirmed plans`,
        followThrough
          ? 'One-sided and missing outcomes are separate.'
          : 'Insufficient publishable evidence.',
      ),
      gate(
        'Experience',
        readinessValid(reviews, 'EXPERIENCE', input.asOf),
        'Sufficient private outcomes and no unresolved severe recurring pattern',
        'Requires qualitative safety review; zero reports cannot establish safety.',
      ),
      gate(
        'Go incremental value',
        false,
        `+${thresholds.GO_INCREMENTAL_MEETINGS_PER_100} mutually positive meetings per 100 over ${thresholds.OUTCOME_HORIZON_DAYS} days`,
        'Not evaluated. Go remains disabled; M6 has not started.',
      ),
    ],
  };
}
