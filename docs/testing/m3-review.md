# M3 review evidence

Scope: Spec P5/P6/P10/P13/P15/P16, plus DEC-036 grant lifecycle and I-04 block
races carried from M2. The branch is `codex/m3-explore-engine`; do not merge its
PR or start M4. All data used for verification is synthetic.

## Merge prerequisite

PR #5 corrections passed the full 67-test local check and all six PR/push jobs
at `3a0e574a5fb3e700e26d24d3f9490f9f7af683bd`. The authorized merge commit is
`5711fe60dfdec9e9ffa6a2f50b2ea38dea2ecb0f`. Main run
[39723068853](https://github.com/abinabrahamColorado/Dating_App/actions/runs/39723068853)
passed all three jobs before branching M3.

## Implementation evidence

- Pure eligibility, estimated centroid travel, recurring availability, stated-fit
  share/product and seeded sequential b-matching are in `core/explore`.
- Migrations 0010/0011 add capacity/exposure ledgers, immutable pair/allocation
  history, proposals/decisions/connections, grants, outbox/mail intents and narrow
  learning writers. Earlier migrations and architecture source files are unchanged.
- Full-cohort weekly generation and operator review/concierge additions call the
  same guarded reservation function. Delivery grants both profiles atomically.
- Per-member decision versions keep the first acceptance private. Pass, expiry,
  block, restriction and close revoke grants and release held slots once.
- Real pg-boss jobs run generation, delivery, maintenance and generic mail. Ambiguous
  SMTP is held for review; opt-in controls reminders. Runtime has no worker safety
  key or operator login. HTTP client shutdown and existing safety paths remain intact.
- `/explore`, `/explore/[id]` and `/ops/explore` provide the finite member and staff
  workflows, with concern/help links and no M4 chat/plan placeholders.

## Validation record

Targeted pure/architecture checks passed: 32 unit tests. Twelve new real-Postgres
tests passed, including both lock orderings for block versus reservation, delivery
and acceptance, racing batches, accept versus expiry, private DTOs, exact-once slot
release, weekly caps, current staff roles, operator propensity and real queue jobs.
Two new Chromium workflows passed with axe and real SMTP/MinIO/Postgres.

The first database run found an overly broad lock request on media; the implementation
now uses the existing narrow media-lock function and a narrow venue-lock function,
without granting serving code approval authority. Browser validation found duplicate
live status regions; the card now has one action-announcement region. Review also
identified cross-edge lock-order risk; multi-pair operations lock the union of member
IDs in global order before visiting pairs. A formatting failure occurred before
the first full suite reached tests; the corrected full result is recorded below.
The full integration run also exposed an obsolete M2 expectation that lifting
enforcement restored profile access. The updated regression proves the restriction
lifts while the old grant remains revoked, as required by the M3 grant lifecycle.
A final pool-saturation regression failed against the initial PR code with an
identity-connection timeout, then passed after guarded reads reused the checked
session transaction. This also repairs the existing shared profile-reader path.

Full `pnpm check` passed on 2026-10-22: typecheck, lint, formatting, 32 unit/property
tests, 46 real PostgreSQL integration tests, production build and 13 Chromium tests
with axe checks — 91 tests total. Generated-key/runtime-password scanning found no
matches in staged source; no ignored environment, service data or browser traces are
published. CI is a separate exact-head gate: use the M3 PR checks and handoff for
the final GitHub run links. Local checks alone do not claim CI success.

Offline benchmark: 20 fixed synthetic six-member graphs; greedy matched exact
cardinality in 14 and trailed by one edge in six. The exact objective is cardinality
then stated-fit sum, not fairness or attraction. No performance/coverage claim for
real members is made by that result.

## Decisions and remaining work

DEC-040: exhaustive pilot cap, operator policy provenance, heuristic input limits.
DEC-041: reservation lease, private decision versions, grants and closure semantics.
DEC-042: generic durable delivery and uncertain-send handling.
DEC-043: finite experience, synthetic venue scope and later release gates.

M2's required reserve/deliver/accept block races are now implemented. M4 must add
message delivery and plan confirmation races and enforce venue switches. M5 retains
D9 retention, legal holds, complete deletion/restore and post-meeting safety links.
Founders still need real venue review, staffed safety operations and launch privacy
approval. The current build remains loopback-only; REA remains uninstalled.
