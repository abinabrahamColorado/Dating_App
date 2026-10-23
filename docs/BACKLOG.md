# Milestone backlog

M0 was reviewed and merged in PR #2. M1 was merged with explicit founder approval
in PR #3 at `a4dee472951f4d11968de6613e6d416f0e227df8`; main CI is green.
M2 merged in PR #5 at `5711fe60dfdec9e9ffa6a2f50b2ea38dea2ecb0f`; main CI
39723068853 passed. M3 is on `codex/m3-explore-engine` for review. Do not merge
its PR or start M4. The earlier hosted preview remains an independent design reference.

Latest review: [execution roadmap](product/roadmap.md),
[architecture gaps](architecture/review-2026-10-20.md),
[competitive research](research/competitive-landscape-2026.md),
[REA evaluation](research/rea-evaluation.md). DEC-029 requires explicit merge
approval. Audit branch `codex/m1-audit-auth-delivery` is stacked on M1 and repairs
auth mail failure isolation. Its CI exposed a PostgreSQL initialization race;
DEC-032 switches readiness to TCP without relaxing the database assertions.
PR #1 is the superseded M0 proposal, now closed without merging with the approved
comment `Superseded by #2.`.

PR #4 merged into M1; PR #3 subsequently merged into main. The founder rejected DEC-031's
crosswalk: CODEX_PROMPTS numbering and order govern. Deletion and operational
readiness before real users or Go are approved; M5 already precedes M6. Duplicate
auth emails after ambiguous sends are accepted. REA stays uninstalled; competitor
research is complete for now (DEC-033). DEC-035 authorizes this M2 build only.

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

- Completed in the open M3 PR #6: founder-requested human-readable profile preview
  labels and "My reports" member navigation (DEC-044). M2 PR #5 had already merged
  when this follow-up arrived. No remaining work or milestone change for this copy.

- M2 defines reusable safety interfaces; M3/M4/M5/M6 must add the relevant race and reachability tests when their paths exist. Do not ship fake plan/chat handlers in M2 merely to make its full future matrix appear complete.
- M1 records deletion and immediately disables discovery; M5 completes orchestration. Do not open live enrollment before deletion and safety flows are ready.
- M3 may introduce a public-venue read model/seed contract solely to test feasibility; full operator venue management belongs to M4. Synthetic venues must not be presented as reviewed real locations.
- M4 implements the founder's under21 alcohol-primary exclusion alongside accessibility, cost and operating-hour filters.
- M5 creates learning-ready data only. No training or inference service belongs to any of the eight milestones.
- M6 must reuse connection-held capacity for existing-match Go, not require an unnecessary free slot. Full stranger Go remains a separate feature flag.
- Production credentials, encryption key management, deployment topology and vendor contracts need a reviewed design before collecting real member data. M1 is restricted to loopback synthetic development.

## Future work outside these eight tasks

Pricing/payments; demographic research; pooled models/embeddings; broad neighborhood GPS; native apps/background permissions; real verification/map vendors; open event marketplace; booking integrations; automated trusted-contact escalation. Each needs a separate authorized milestone and explicit privacy/operations gates.

- V1/V2 matching work: [Algorithm literature and build cards A1–A10](research/algorithm-literature.md); each card requires its data threshold to be met and explicit founder approval before implementation.

## Release work retained from M1

- Complete: G07 auth delivery repair/regression evidence; M2 fixes G02 session
  revalidation and G03 staff-role revocation at protected operations, including
  case access and staff media reads. M2 fixes G04 independent enforcement.
- G08: M2 command keys survive ambiguous-response retries while the page remains
  open. M1's other command keys and swallowed refresh failures remain open;
  page-reload recovery of pending M2 commands also remains open (DEC-038).
- Before real accounts: G09 ambiguous media-upload commit compensation remains
  open. M2 did not change upload writes. Live enrollment remains disabled.
- G01 shared auth-mail wiring is fixed in M3: web and worker use `packages/runtime`;
  worker construction uses queue, app and identity pools, not ops/safety pools.
  Local processes still share ignored `.env`; production process-secret isolation
  and purpose-scoped identity delivery remain M7 work.

- M2 complete: reporting/appeals for restricted/exited members, separate safety
  and integrity queues, audited safety-role access, bilateral profile/photo denial,
  precaution/lift, account and stored venue/event/Go controls. Before live use:
  named reviewers, per-case assignment/workload routing (REQ-150), incident lead,
  support hours, escalation and case-retention review. Appeals require a different
  reviewer from the challenged decision maker.
- M3 implemented: bilateral grants on delivery, revocation on terminal transitions,
  locked denial at retrieval/reservation/delivery/acceptance; both orderings of
  block-vs-reservation/delivery/acceptance are tested on Postgres. Queued product
  mail is checked again under the pair lock. SMTP already accepted by a transport
  cannot be recalled; see DEC-042.
- M4: enforce denial in chat and plans; add block-vs-message/delivery/confirmation
  races and concern links on these surfaces. Enforce stored venue shutdowns.
- M5/M6: add post-meeting concern links and enforce stored event/Go shutdowns;
  retain report/help access during every shutdown. M5 retains erasure/restore work.
- M3 implemented: bilateral preference/block/capacity/travel/availability gates,
  conditional exposure logging, permanent pair history and a synthetic exact benchmark.
  Before scaling beyond 200 review members: load-test retrieval/lock duration and
  introduce a reviewed bounded retrieval policy with explicit retrieval-miss accounting.
  Do not silently truncate the exhaustive pilot cohort (DEC-040).
- M5: erase stores/exports, reconcile encrypted media orphans, expire auth/outbox/
  rate-limit records, apply tombstones on restore and prove retention deadlines.
- M5: enforce D9 safety retention: 24 calendar months after case closure, annual
  review and shorter retention where unneeded; case-specific legal holds prevent
  deletion only for their documented scope/duration. Add expiry, hold/release and
  restored-backup tests. M2 stores cases but does not run this retention job.
- M7: passkey listing/removal/recovery with recent authentication; production
  KMS/key rotation, scoped object-storage credentials, real mail transport, strict
  CSP, per-request body deadlines, broader abuse budgets, additional staff abuse scenarios,
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
