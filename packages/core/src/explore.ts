import { z } from 'zod';
import { launch, pilot } from '@meetwell/config/pilot';
import { boundariesAllow, localDate, type Profile, type Preferences } from './accounts';
import { isDenied, orderedPair, type PairMember } from './safety';

export type ExploreMember = Omit<PairMember, 'blocksOther'> & {
  intent: 'EXPLORE' | 'FOCUS';
  age: number;
  profile: Profile;
  preferences: Preferences;
  complete: boolean;
  approvedPhotos: number;
  freeSlots: number;
  remainingWeekly: number;
  lastOfferAt: string | null;
  joinedAt: string;
  profileVersion: number;
  preferenceVersion: number;
  policyVersion: number;
};
export type Venue = {
  id: string;
  centroid: readonly [number, number];
  approved: boolean;
  reviewExpiresAt: string;
  alcoholPrimary: boolean;
};
export type PairFacts = {
  u: string;
  v: string;
  blockedBy: string[];
  legacyDenied: boolean;
  hasHistory: boolean;
};
export type EligibilityStage = 'RETRIEVAL' | 'RESERVATION' | 'DELIVERY' | 'ACCEPTANCE';
export function pairKey(u: string, v: string) {
  return orderedPair(u, v).join(':');
}
export function weekKey(now: Date) {
  const d = new Date(`${localDate(now)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
/** P6: area-to-public-venue estimate, never a member's precise position or route. */
export function estimatedTravelMinutes(profile: Profile, venue: Venue): number {
  const area = launch.areas.find((a) => a.id === profile.areaId);
  if (!area) return Infinity;
  const [lat, lon] = area.centroid,
    [vlat, vlon] = venue.centroid,
    rad = Math.PI / 180;
  const h =
    Math.sin(((vlat - lat) * rad) / 2) ** 2 +
    Math.cos(lat * rad) * Math.cos(vlat * rad) * Math.sin(((vlon - lon) * rad) / 2) ** 2;
  const km = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  return (
    ((km * pilot.TRAVEL_ESTIMATE_DETOUR_FACTOR) / pilot.TRAVEL_ESTIMATE_KMH[profile.transport]) * 60
  );
}
function upcomingWindows(profile: Profile, now: Date) {
  const date = localDate(now),
    first = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: launch.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const minute =
    Number(parts.find((p) => p.type === 'hour')!.value) * 60 +
    Number(parts.find((p) => p.type === 'minute')!.value);
  const windows: { day: number; start: number; end: number }[] = [];
  for (let offset = 0; offset < pilot.AVAILABILITY_HORIZON_DAYS; offset++) {
    const day = (first.getUTCDay() + offset) % 7;
    for (const w of profile.availability.windows)
      if (w.day === day) {
        const start = Math.max(w.start, offset === 0 ? minute : 0);
        if (w.end > start) windows.push({ day: offset, start, end: w.end });
      }
  }
  return windows;
}
export function availabilityFeasible(a: Profile, b: Profile, now: Date) {
  const x = upcomingWindows(a, now),
    y = upcomingWindows(b, now);
  if (a.availability.flexible && b.availability.flexible) return true;
  if (a.availability.flexible) return y.length > 0;
  if (b.availability.flexible) return x.length > 0;
  return x.some((u) =>
    y.some((v) => u.day === v.day && Math.min(u.end, v.end) > Math.max(u.start, v.start)),
  );
}
/** I-02/I-04/I-05. Call only with current facts under app.lock_pair in persistence.
 * DELIVERY/ACCEPTANCE consume an existing reservation; its held slots are not a new cap check. */
export function eligible(
  a: ExploreMember,
  b: ExploreMember,
  now: Date,
  facts: PairFacts,
  venues: readonly Venue[],
  stage: EligibilityStage = 'RETRIEVAL',
) {
  const deny = (m: ExploreMember) => ({
    ...m,
    blocksOther: facts.legacyDenied || facts.blockedBy.includes(m.id),
  });
  if (isDenied(deny(a), deny(b)) || a.intent !== 'EXPLORE' || b.intent !== 'EXPLORE') return false;
  if (!a.complete || !b.complete || [a, b].some((m) => m.approvedPhotos < pilot.PROFILE_MIN_PHOTOS))
    return false;
  const newReservation = stage === 'RETRIEVAL' || stage === 'RESERVATION';
  if (
    newReservation &&
    (facts.hasHistory || [a, b].some((m) => m.freeSlots <= 0 || m.remainingWeekly <= 0))
  )
    return false;
  if (!boundariesAllow(a, b) || !availabilityFeasible(a.profile, b.profile, now)) return false;
  return venues.some(
    (v) =>
      v.approved &&
      new Date(v.reviewExpiresAt) > now &&
      (!v.alcoholPrimary || [a, b].every((m) => m.age >= pilot.ALCOHOL_PRIMARY_VENUE_MIN_AGE)) &&
      estimatedTravelMinutes(a.profile, v) <= a.profile.travelMinutes &&
      estimatedTravelMinutes(b.profile, v) <= b.profile.travelMinutes,
  );
}
export type FitSignal = { strength: 'SOFT' | 'STRONG'; matches: boolean | null };
/** Missing self-description is left out of numerator AND denominator. */
export function weightedStatedShare(signals: readonly FitSignal[]) {
  let total = 0,
    satisfied = 0;
  for (const s of signals)
    if (s.matches !== null) {
      const w =
        s.strength === 'STRONG' ? pilot.STRONG_PREFERENCE_WEIGHT : pilot.SOFT_PREFERENCE_WEIGHT;
      total += w;
      if (s.matches) satisfied += w;
    }
  return total === 0 ? 1 : satisfied / total;
}
function statedSignals(u: ExploreMember, v: ExploreMember): FitSignal[] {
  const p = u.preferences,
    result: FitSignal[] = [];
  if (p.age.setting === 'STRONG')
    result.push({ strength: 'STRONG', matches: v.age >= p.age.min && v.age <= p.age.max });
  for (const attribute of ['intention', 'structure', 'smoking'] as const) {
    const preference = p[attribute];
    if (preference.setting === 'STRONG')
      result.push({
        strength: 'STRONG',
        matches:
          v.profile[attribute] === 'not-stated'
            ? null
            : (preference.values as string[]).includes(v.profile[attribute]),
      });
  }
  // M1 has no explicit SOFT input; interests are self-description, not inferred preferences.
  return result;
}
/** P15. A priority heuristic, never a probability and never a member-facing score. */
export function statedFitHeuristic(a: ExploreMember, b: ExploreMember) {
  return weightedStatedShare(statedSignals(a, b)) * weightedStatedShare(statedSignals(b, a));
}
function seedNumber(seed: string) {
  let value = 2166136261;
  for (const c of seed) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return value >>> 0;
}
export function seededRandom(seed: string) {
  let value = seedNumber(seed) || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}
export type Edge = { key: string; u: string; v: string; heuristic: number; waitBuckets: number };
export type AllocationStep = {
  edge: Edge;
  step: number;
  seed: string;
  feasibleId: string;
  feasible: string[];
  size: number;
  ruleBest: string;
  branch: 'RULE' | 'EXPLORATION';
  q: number;
  probabilities: { key: string; q: number }[];
};
export type UnservedReason = 'zero eligible supply' | 'retrieval miss' | 'capacity' | 'paused';
export function feasibleEdges(
  members: readonly ExploreMember[],
  facts: readonly PairFacts[],
  venues: readonly Venue[],
  now: Date,
): Edge[] {
  const map = new Map(members.map((m) => [m.id, m])),
    seen = new Set<string>(),
    edges: Edge[] = [];
  for (const f of facts) {
    const u = map.get(f.u),
      v = map.get(f.v),
      key = pairKey(f.u, f.v);
    if (!u || !v || seen.has(key) || !eligible(u, v, now, f, venues)) continue;
    seen.add(key);
    const days = (m: ExploreMember) =>
      Math.max(0, (now.getTime() - new Date(m.lastOfferAt ?? m.joinedAt).getTime()) / 86400000);
    edges.push({
      key,
      u: u.id,
      v: v.id,
      heuristic: statedFitHeuristic(u, v),
      waitBuckets: Math.floor(Math.max(days(u), days(v)) / pilot.WAIT_PRIORITY_BUCKET_DAYS),
    });
  }
  return edges;
}
/** P13/P16 sequential greedy general-graph b-matching with exact conditional q. */
export function allocate(
  members: readonly ExploreMember[],
  facts: readonly PairFacts[],
  venues: readonly Venue[],
  now: Date,
  seed: string,
  epsilon: number = pilot.EXPLORATION_EPSILON,
) {
  if (!Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1) throw Error('INVALID_EPSILON');
  const edges = feasibleEdges(members, facts, venues, now).sort(
    (a, b) =>
      b.waitBuckets - a.waitBuckets ||
      b.heuristic - a.heuristic ||
      seedNumber(`${seed}:${a.key}`) - seedNumber(`${seed}:${b.key}`) ||
      a.key.localeCompare(b.key),
  );
  const budgets = new Map(
    members.map((m) => [m.id, Math.max(0, Math.min(m.freeSlots, m.remainingWeekly))]),
  );
  const chosen = new Set<string>(),
    steps: AllocationStep[] = [],
    random = seededRandom(seed);
  while (true) {
    const remaining = edges.filter(
      (e) => !chosen.has(e.key) && budgets.get(e.u)! > 0 && budgets.get(e.v)! > 0,
    );
    if (!remaining.length) break;
    const best = remaining[0]!,
      branch = random() < epsilon ? 'EXPLORATION' : 'RULE';
    const edge = branch === 'RULE' ? best : remaining[Math.floor(random() * remaining.length)]!;
    const probabilities = remaining.map((e) => ({
      key: e.key,
      q: (e.key === best.key ? 1 - epsilon : 0) + epsilon / remaining.length,
    }));
    const step = steps.length;
    steps.push({
      edge,
      step,
      seed,
      feasibleId: `${seed}/${step}`,
      feasible: remaining.map((e) => e.key),
      size: remaining.length,
      ruleBest: best.key,
      branch,
      q: probabilities.find((e) => e.key === edge.key)!.q,
      probabilities,
    });
    chosen.add(edge.key);
    for (const id of [edge.u, edge.v]) budgets.set(id, budgets.get(id)! - 1);
  }
  const served = new Set(steps.flatMap((s) => [s.edge.u, s.edge.v]));
  const unserved = members
    .filter((m) => !served.has(m.id))
    .map((m) => {
      let reason: UnservedReason = 'zero eligible supply';
      if (m.state !== 'ACTIVE' || m.intent !== 'EXPLORE' || m.restricted || m.deleted)
        reason = 'paused';
      else if (
        m.freeSlots <= 0 ||
        m.remainingWeekly <= 0 ||
        edges.some((e) => e.u === m.id || e.v === m.id)
      )
        reason = 'capacity';
      else if (!facts.some((f) => f.u === m.id || f.v === m.id) && members.length > 1)
        reason = 'retrieval miss';
      return { memberId: m.id, reason };
    });
  return { steps, unserved };
}
/** P16 offline benchmark only; exact cardinality first, then stated-fit sum. */
export function exactSmallGraph(edges: readonly Edge[], capacity: ReadonlyMap<string, number>) {
  if (edges.length > pilot.EXACT_BENCHMARK_MAX_EDGES) throw Error('BENCHMARK_TOO_LARGE');
  let best: Edge[] = [];
  let bestValue = 0;
  const left = new Map(capacity),
    selected: Edge[] = [];
  const visit = (index: number, value: number) => {
    if (index === edges.length) {
      if (selected.length > best.length || (selected.length === best.length && value > bestValue)) {
        best = [...selected];
        bestValue = value;
      }
      return;
    }
    if (selected.length + edges.length - index < best.length) return;
    const e = edges[index]!;
    if (left.get(e.u)! > 0 && left.get(e.v)! > 0) {
      left.set(e.u, left.get(e.u)! - 1);
      left.set(e.v, left.get(e.v)! - 1);
      selected.push(e);
      visit(index + 1, value + e.heuristic);
      selected.pop();
      left.set(e.u, left.get(e.u)! + 1);
      left.set(e.v, left.get(e.v)! + 1);
    }
    visit(index + 1, value);
  };
  visit(0, 0);
  return { edges: best, value: bestValue };
}
export type OpportunityState =
  | 'RESERVED'
  | 'PROPOSED'
  | 'MUTUAL'
  | 'PASSED'
  | 'EXPIRED'
  | 'BLOCKED'
  | 'RESTRICTED'
  | 'CLOSED'
  | 'CANCELLED';
export type Decision = 'UNDECIDED' | 'ACCEPT' | 'PASS';
export function decisionOutcome(
  state: OpportunityState,
  expiresAt: Date,
  now: Date,
  own: Decision,
  other: Decision,
): OpportunityState {
  if (state !== 'PROPOSED') return state;
  if (now >= expiresAt) return 'EXPIRED';
  if (own === 'PASS' || other === 'PASS') return 'PASSED';
  if (own === 'ACCEPT' && other === 'ACCEPT') return 'MUTUAL';
  return 'PROPOSED';
}
export function memberStatus(state: OpportunityState, own: Decision) {
  if (state === 'MUTUAL') return 'MUTUAL';
  if (state === 'PROPOSED') return own === 'ACCEPT' ? 'RESPONSE_SAVED' : 'AWAITING_RESPONSE';
  if (state === 'EXPIRED') return 'EXPIRED';
  if (state === 'CLOSED') return 'CLOSED';
  if (own === 'PASS') return 'YOU_PASSED';
  return 'UNAVAILABLE'; // No reason, block identity or other member's decision.
}
export const decisionSchema = z
  .object({ version: z.number().int().nonnegative(), decision: z.enum(['ACCEPT', 'PASS']) })
  .strict();
export const capacitySchema = z
  .object({
    version: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(pilot.MAX_ACTIVE_CONNECTIONS),
    reminders: z.boolean(),
  })
  .strict();
export const batchSchema = z
  .object({
    seed: z.string().min(1).max(100),
    members: z.array(z.uuid()).min(2).max(pilot.EXPLORE_MAX_REVIEW_MEMBERS).optional(),
  })
  .strict();
