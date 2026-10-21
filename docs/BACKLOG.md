# Milestone backlog

M0 was reviewed and merged in PR #2 (commit
`16676f3b34020c0b626964f4063bb33f9cbd5cf1`). M1 accounts, onboarding, public
pages and photo-review controls are implemented on `codex/m1-accounts-onboarding`.
Review its tests, decisions and PR before merging and starting M2. The earlier
hosted preview remains an independent design reference.

Latest review: [execution roadmap/crosswalk](product/roadmap.md),
[architecture gaps](architecture/review-2026-10-20.md),
[competitive research](research/competitive-landscape-2026.md),
[REA evaluation](research/rea-evaluation.md). DEC-029 requires explicit merge
approval. Audit branch `codex/m1-audit-auth-delivery` is stacked on M1 and repairs
auth mail failure isolation. PR1 is an older conflicting M0 proposal; do not merge
it over PR2's accepted foundation. Founder decision is needed to close it.

| Milestone | Deliverable                                                                                                                             | Gate before moving on                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| M0        | Requirement map, architecture, config, pnpm scaffold, real infrastructure/migration/test setup                                          | Green quality gates; founder review of decisions and scope                                                          |
| M1        | Public site, email magic link/passkey, adult onboarding, moderated media, versioned preferences, state axes, ops foundation             | I-01/I-02-function/I-03/I-13/I-19 tests; onboarding and axe E2E; no public pilot yet                                |
| M2        | Bilateral deny policy, independent reports/blocks, case review/appeals, integrity routing, staff audit and kill switches                | Database role isolation; safety reachability on existing surfaces; race tests for available transitions             |
| M3        | Bilateral eligibility, travel/availability, deterministic heuristic/allocator, atomic reservations, review/outbox, private finite cards | Property/concurrency suites; I-02/I-05/I-06/I-07/I-08/I-15/I-16; exact small-graph benchmark                        |
| M4        | Mutual chat, approved venue operations, immutable plan versions and bilateral approval, calendar/share                                  | I-09 confirmation/closure/cancel races, venue filters, I-04 and I-11 on new surfaces                                |
| M5        | Private feedback, attendance provenance, outcome cohorts/exports, metrics and deletion/restore                                          | I-10/I-12/I-18; denominator fixtures; forbidden-field scans; deletion drills                                        |
| M6        | Flagged events and event-token Go; existing matches first, separate new-person gate                                                     | I-14 revocation/retry/restart races; organizer isolation; staffed-window readiness; flags remain off until approval |
| M7        | Route/role/object matrix, security/rate budgets, accessibility/mobile audit, runbooks, privacy/release review                           | All20 invariant suites green; P23 gates and documented human operations/legal/venue review                          |

## Dependency refinements

- M2 defines reusable safety interfaces; M3/M4/M5/M6 must add the relevant race and reachability tests when their paths exist. Do not ship fake plan/chat handlers in M2 merely to make its full future matrix appear complete.
- M1 records deletion and immediately disables discovery; M5 completes orchestration. Do not open live enrollment before deletion and safety flows are ready.
- M3 may introduce a public-venue read model/seed contract solely to test feasibility; full operator venue management belongs to M4. Synthetic venues must not be presented as reviewed real locations.
- M4 implements the founder's under21 alcohol-primary exclusion alongside accessibility, cost and operating-hour filters.
- M5 creates learning-ready data only. No training or inference service belongs to any of the eight milestones.
- M6 must reuse connection-held capacity for existing-match Go, not require an unnecessary free slot. Full stranger Go remains a separate feature flag.
- Production credentials, encryption key management, deployment topology and vendor contracts need a reviewed design before collecting real member data. M1 is restricted to loopback synthetic development.

## Future work outside these eight tasks

Pricing/payments; demographic research; pooled models/embeddings; broad neighborhood GPS; native apps/background permissions; real verification/map vendors; open event marketplace; booking integrations; automated trusted-contact escalation. Each needs a separate authorized milestone and explicit privacy/operations gates.

## Release work retained from M1

- M1 review: G07 auth delivery repair and its regression evidence; G08 stable
  client retry keys/refresh recovery remain open. No unmerged work is discarded.
- Before real accounts: G03 staff/disclosure revocation races and G09 ambiguous
  media commit compensation; live enrollment remains disabled until resolved.
- M2: G01 extract shared auth-mail wiring and minimize worker credentials;
  G04 independent enforcement survives account exit/deletion/appeal.

- M2: reporting/appeal access for restricted and exited members, assigned safety
  cases and atomic enforcement/discovery integration. No case narratives in ops.
- M3: compose the tested bilateral preference function with blocks, capacity and
  actual travel/availability feasibility. Add exposure logging and closed-pair memory.
- M5: erase stores/exports, reconcile encrypted media orphans, expire auth/outbox/
  rate-limit records, apply tombstones on restore and prove retention deadlines.
- M7: passkey listing/removal/recovery with recent authentication; production
  KMS/key rotation, scoped object-storage credentials, real mail transport, strict
  CSP, per-request body deadlines, broader abuse budgets, staff-role revocation races,
  manual screen-reader testing and accessibility audit. Keep live enrollment closed.
- Founder review: provisional vocabulary, age-out/return policy, operational support,
  name/areas, privacy review and production providers. See DEC-024–028.

- M3–M7: whole-process worker crash/slow transport tests, body deadlines, queue
  monitoring, test-fixture isolation under repeated auth budgets, immutable CI
  action revisions and automated secret/dependency scanning (G07/G13/G15).
- Product research: proposed comprehension/coverage/planning/Go/cost experiments
  need a reviewed protocol and relevant live safety/privacy gates. No competitor
  outcome, unique algorithm or market advantage has been established by desk research.

## Infrastructure verification

Track current evidence in PROJECT_STATUS.md and the original recovery history in
M0_REPORT.md. The Windows checkout now runs real PostgreSQL 16/PostGIS, MinIO and
Mailpit. Six database integration tests pass locally, including a restricted-worker
durable job. Preserve the distinction between local native verification, Linux
Compose CI, and unverified installer paths. GitHub CI remains a merge gate.
