import {
  allocate,
  exactSmallGraph,
  feasibleEdges,
  seededRandom,
} from '../packages/core/src/explore';
import { exploreMember, allPairs, syntheticVenue, exploreNow } from '../tests/fixtures/explore';
// P16: reproducible synthetic general graphs; cardinality then stated-fit sum.
const results = Array.from({ length: 20 }, (_, run) => {
  const seed = `benchmark-${run}`,
    random = seededRandom(seed);
  const ms = Array.from({ length: 6 }, (_, i) =>
    exploreMember(`synthetic-${i}`, 1 + Math.floor(random() * 2)),
  );
  const facts = allPairs(ms).filter(() => random() > 0.3);
  const edges = feasibleEdges(ms, facts, [syntheticVenue], exploreNow);
  const greedy = allocate(ms, facts, [syntheticVenue], exploreNow, seed);
  const exact = exactSmallGraph(
    edges,
    new Map(ms.map((m) => [m.id, Math.min(m.freeSlots, m.remainingWeekly)])),
  );
  return {
    seed,
    edges: edges.length,
    greedy: greedy.steps.length,
    exact: exact.edges.length,
    cardinalityGap: exact.edges.length - greedy.steps.length,
  };
});
process.stdout.write(
  `${JSON.stringify({ objective: 'maximum cardinality then stated-fit sum; no claim of fairness or attraction optimality', results }, null, 2)}\n`,
);
