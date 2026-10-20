# M0 review report

Prepared: 2026-10-16. Verification resumed: 2026-10-20. Catchment: Manhattan, New York City. Ages: 18–30 inclusive. Working name: Meetwell. This change contains the engineering foundation and planning documents only.

## Plan for M1–M7

| Task | Build                                                                                                        | Review gate                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| M1   | Public site, accounts, adult onboarding, moderated profiles, explicit preferences and independent state axes | Adult/DOB isolation, authorization, consent and accessible onboarding tests                   |
| M2   | Blocks, independent reporting, integrity routing, case handling, appeals, staff audit and kill switches      | Database isolation and safety reachability; race tests for paths already implemented          |
| M3   | Explore eligibility, heuristic and allocator, atomic capacity, operator review, outbox and blind decisions   | Property tests, real database races, exact small-graph benchmark and truthful empty states    |
| M4   | Chat, approved venues, shared plan versions, confirmation, calendar and manual sharing                       | Confirmation/closure/cancellation races, venue filters and safety on every new surface        |
| M5   | Private feedback, attendance provenance, outcome metrics, exports and deletion/restore                       | Fixed-cohort metric fixtures, prohibited-field scans and deletion drills                      |
| M6   | Events and event-bound Go, existing connections first                                                        | Epoch/revocation races, organizer isolation and staffed readiness; all three flags remain off |
| M7   | Security, route authorization matrix, accessibility, runbooks and release review                             | All 20 invariant suites plus human privacy, venue and operations checks                       |

Recommended dependency refinements: M2 supplies reusable safety controls and adds each future surface's tests when that surface exists. M3 needs a minimal approved-venue read contract before M4's management interface. Existing-match Go reuses its already-held slot. No live enrollment should start before safety, deletion and release gates are complete. Review and merge each milestone before beginning the next.

## Ten highest-risk requirements and their tests

| Risk                                                                    | Required proof                                                                                                                             | Milestone    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| I-06: double booking or releasing a slot twice                          | Concurrent batches, reserve/block/expiry races, sorted bilateral locks, exactly-once release and acceptance of the last held slot          | M3, M6       |
| I-04: a blocked pair leaks through a queued or concurrent action        | Block at retrieval, reservation, delivery, acceptance and plan confirmation; stale-device and worker-restart tests                         | M2–M4, M6–M7 |
| I-14: Nearby off leaves a valid token or queued notification            | Epoch mismatch, Stop/accept and Stop/delivery races, offline acknowledgement and authorization-store failure                               | M6–M7        |
| I-09: members confirm different plans or a closed venue                 | CAS/idempotency replay, version mismatch, venue-closure/confirmation and cancellation/confirmation races                                   | M3–M4        |
| I-02: one person's boundary is relaxed or checked in only one direction | Property tests over bilateral hard gates, unknown attributes, edited preferences and all retrieval routes                                  | M1, M3, M6   |
| I-05: a closed pair is reintroduced                                     | Canonical unordered uniqueness, race tests and replay through Explore/events/Go after mode or area changes                                 | M3, M6       |
| I-12/I-19/I-20: safety narrative or private records leak across roles   | Real PostgreSQL privilege probes, route × role × ownership matrix, forbidden-field scans and immutable access audit                        | M2, M5, M7   |
| I-18: deletion is undone by an export or restore                        | Seed every store, delete, verify deadlines, restore old backups and replay tombstones before opening traffic                               | M5, M7       |
| I-07/I-10: a private decision or feedback becomes visible               | Two-member E2E views, unauthorized object/field requests, no premature mutual reveal and independent invite-to-meet-again action           | M3, M5       |
| I-15: incorrect propensity data makes later analysis misleading         | Per-step conditional probabilities sum to one, fixed-seed determinism, feasible-set replay and distinct unknown-propensity operator policy | M3, M5       |

## Founder questions

1. Keep the provisional name **Meetwell** and all eight configured Manhattan areas?
2. Confirm the proposed age-out policy: stop new introductions at 31 while keeping closure, reporting and access to existing records available. Should existing consensual chats continue?
3. Who handles safety incidents, and during which staffed hours? Go remains off until coverage is defined.
4. Which relationship intentions, structures and optional explicit boundaries belong in the first pilot?
5. Should this GitHub repository and its architecture remain public? They currently are public.
6. Which hosting, email and private storage providers should be reviewed before live use?
7. Who reviews retention, case holds and venue accessibility before enrollment?

These are review questions, not claims that live operations are ready. Full rationale and protective defaults are in [DECISIONS.md](DECISIONS.md).

## What was built

- A trace of 193 testable requirements, all 20 invariants, planned tests and out-of-scope items.
- Architecture covering the in-scope Part 22 entities, keys/indexes, schema roles, state machines, authorized routes, capacity locks, outbox, deletion and D1–D15 handling.
- Strict TypeScript/pnpm workspaces for Next.js, a real pg-boss infrastructure worker, pure core logic, PostgreSQL/Drizzle migrations and centralized pilot config.
- An infrastructure-only Next.js page and `/api/v1/health` endpoint; a durable worker health-check queue.
- Forward migration for separate schemas and least-privilege runtime groups; migration checksums and serialization.
- Docker Compose and a native Ubuntu fallback for PostgreSQL 16/PostGIS, MinIO and Mailpit. CI verifies the application gates and Compose service health.
- Vitest, fast-check and Playwright checks. Product invariant suites are explicitly planned, not represented by fake passing stubs.

## Verification

[CI run 39378020161](https://github.com/abinabrahamColorado/Dating_App/actions/runs/39378020161) passed both jobs on commit `00194ce3daf5485ccb5060ea3704f96f1cd2f592`, on 2026-10-20:

```text
Frozen dependency installation: passed
Typecheck / lint / formatting: passed
Unit tests: 6 files passed; 9 tests passed
Real PostgreSQL 16 + PostGIS integration: 5 tests passed
Next.js production build: passed
Chromium end-to-end test: 1 passed
Compose: PostgreSQL, MinIO and Mailpit healthy
Separate development and test databases: verified
```

The initial CI run caught pg-boss trying to create its existing schema without database CREATE privilege. DEC-022 fixes the configuration and adds a privilege regression check; permissions were not broadened. The subsequent startup path fix resolves the root `.env` file explicitly when pnpm runs the worker from its package directory. Follow-up commits run the same CI gates; the current [PR #1 checks](https://github.com/abinabrahamColorado/Dating_App/pull/1/checks) are authoritative for the latest branch head.

Local typecheck, lint, formatting, build, all 9 unit tests and shell syntax checks also passed. Local integration and browser attempts were blocked by environmental prerequisites: this sandbox cannot switch to a PostgreSQL service user, and its browser download was truncated. The successful CI tests use real PostgreSQL/PostGIS and Chromium; there is no SQLite or memory fallback. The alternative native Ubuntu installer remains unverified on a normal host; the passing Compose job does not certify that installer.

The GitHub access blocker from 2026-10-16 was resolved on 2026-10-20. The M0 branch and draft PR are published. Founder review and merge are still outstanding; M1 has not started.

## Decisions and scope limits

No production stack replacement: DEC-001 separates the prior preview from this repository. DEC-002 distinguishes static public reference centroids from prohibited member coordinates. DEC-003/007/010/012/013 document age-out, deletion/pair retention and other unresolved policies. DEC-004/015 resolve milestone dependency issues. DEC-005/006 preserve privacy and exclude models. DEC-009 applies the under-21 venue rule. DEC-014 avoids fake invariant coverage. DEC-016 records the environment restriction. DEC-017/018/021 record exact dependency pins and supported compiler/linter compatibility. DEC-019 retains provisional branding/areas; DEC-020 isolates safety data; DEC-022 preserves least privilege during queue startup.

Deliberately not built: accounts, onboarding, member profiles, matching, reports, chat, venue management, plans, feedback, metrics, deletion jobs, events, Go, models, payments, real vendor integrations or production deployment. No M1 work begins in this PR.
