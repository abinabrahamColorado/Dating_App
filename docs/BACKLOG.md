# Milestone backlog

Only M0 is in progress. Review its PR, reconcile founder questions, and merge it before M1. No later feature has been implemented by this change. The earlier hosted preview remains an independent design reference.

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
- Production credentials, encryption key management, deployment topology and vendor contracts need a reviewed design before M1 sensitive data collection.

## Future work outside these eight tasks

Pricing/payments; demographic research; pooled models/embeddings; broad neighborhood GPS; native apps/background permissions; real verification/map vendors; open event marketplace; booking integrations; automated trusted-contact escalation. Each needs a separate authorized milestone and explicit privacy/operations gates.

## M0 verification limits to close

Track actual local and CI outcomes in M0_REPORT.md. A missing test service is a failed/unrun gate, never a pass. Validate the Compose/native service setup in an environment with normal non-root service users; this execution sandbox cannot run PostgreSQL. Keep that limitation visible even if CI database tests pass.
