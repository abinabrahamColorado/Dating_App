# Project status

Updated 2026-11-18 (America/Chicago). Working name: **Meetwell**.
Pilot proposal: Manhattan, New York City; ages 18–30.

Permanent checkout: `E:\Buisness\Dating_App`.
Remote: `https://github.com/abinabrahamColorado/Dating_App`.
M5 [PR #22](https://github.com/abinabrahamColorado/Dating_App/pull/22) merged with
founder approval using a merge commit, `83e3a2377ec6aa1c20308958bd37177bb8db17c1`.
Main run [44267728623](https://github.com/abinabrahamColorado/Dating_App/actions/runs/44267728623)
failed the production dependency audit on two Next.js advisories; main is not
green. No audit gate was weakened and no dependency PR is approved for merge.
Current work: separate `codex/prevent-enforced-rejoin` security correction
(DEC-059), not M6. New PR must remain unmerged. Dependabot #13–#21 are review only.
Local correction checks: typecheck, lint, formatting and 55 unit tests passed.
`corepack pnpm check` reached integration tests and stopped at PostgreSQL
`ECONNREFUSED 127.0.0.1:55432`; database validation awaits hosted CI. The separate
production build compiled/typechecked but exited with Next.js `SecurityFatalError`
for the dependency advisories. No security warning or audit threshold was bypassed.
Security PR #11 merged with founder approval at `37bb33f` after all six checks
passed at `cdab890` (46 unit + 74 PostgreSQL + 18 browser/axe = 138 tests).
Main CI 43879455326 passed all three quality jobs. DEC-054 records the focused,
founder-approved block/profile race test synchronization repair.
Docs/design PR #9 was updated from that main, passed CI 43879610594, and merged
at `cc61242`. Its three motion-reference files are unchanged and are not integrated
into application components. Final main CI
[43881320513](https://github.com/abinabrahamColorado/Dating_App/actions/runs/43881320513)
passed `verify`, `windows`, and `dev-services` before the M5 branch was created.

M5 is authorized exactly as CODEX_PROMPTS.md: feedback, attendance provenance,
separate learning datasets/exports, optional success exits/follow-ups, fixed-cohort
metrics, retention, deletion receipts and restore tombstone replay. Implementation
and its 162-test suite are complete; PR #22 is now merged. M6, design-motion integration, research
build cards, deployment and real enrollment are not authorized by this task.
Monitoring remains the self-hosted Uptime Kuma plan, with vendor selection deferred
until hosting and no Sentry/vendor SDK (DEC-053).

M5 adds morning-after private feedback, separate invitation and reporting paths,
attendance provenance, opt-in success follow-ups, separate learning snapshots,
fixed-cohort metrics and expiring readiness evidence. Deletion covers primary
data, encrypted media versions and exports; the independent journal is replayed
before a restored database can serve member requests. D9 retention includes
audited case-specific hold/release and annual-review controls. DEC-055–058 and
[the lifecycle runbook](operations/privacy-lifecycle.md) document the boundaries.
Local evidence: pinned-toolchain frozen install, typecheck, lint, formatting,
55 unit tests and production build passed. The full local check stops at
PostgreSQL connection refusal. Hosted Linux verification at `521f1ce` passed
55 unit + 85 real PostgreSQL/storage + 22 Chromium/axe tests = **162 tests**,
including old-backup restoration, quarantine and deletion replay. Run
[43896712076](https://github.com/abinabrahamColorado/Dating_App/actions/runs/43896712076)
also passed full-history secret scanning and the production dependency audit.
All six quality jobs at `521f1ce` passed in runs
[43896712076](https://github.com/abinabrahamColorado/Dating_App/actions/runs/43896712076)
and [43896938660](https://github.com/abinabrahamColorado/Dating_App/actions/runs/43896938660),
including complete `corepack pnpm check` on both Windows runners.
The [PR checks](https://github.com/abinabrahamColorado/Dating_App/pull/22/checks)
are authoritative for the latest commit's six required Linux, Windows and
development-service jobs; Windows runs the complete `corepack pnpm check`.
Never infer current-head CI from a previous commit's result.

Local verification on 2026-11-16 could not start PostgreSQL: Windows Device Guard
blocked the existing `.local/tools/pgsql/bin/postgres.exe`. No policy exception,
replacement executable or security-control change was attempted. The machine's
security administrator must resolve that local execution block before local
database checks can resume; fresh GitHub CI is independent evidence, not a claim
that the local environment works. Existing local data is preserved.
Main rules remain inactive pending GitHub sign-in in the in-app tab. Workspace
access with Approve for me remains a recommendation, not a verified permission
profile: the current chat still has Full Access/never. The app controls could not
be re-inspected while the native windows were minimized; follow the documented
composer steps after this run, then verify a full check under the chosen profile.
No research build card is authorized.
See [development setup](DEVELOPMENT_SETUP.md) and DEC-049 for settings evidence,
remaining UI actions and permissions tradeoffs.
PR #3 merged with explicit founder
approval at `a4dee472951f4d11968de6613e6d416f0e227df8`. Main CI
[39547453037](https://github.com/abinabrahamColorado/Dating_App/actions/runs/39547453037)
is green. PR #1 is closed without merging, with `Superseded by #2.`. The founder
approved M2 after the DEC-039 corrections passed 67 local tests and green CI.
[PR #5](https://github.com/abinabrahamColorado/Dating_App/pull/5) merged at
`5711fe60dfdec9e9ffa6a2f50b2ea38dea2ecb0f`; main CI
[39723068853](https://github.com/abinabrahamColorado/Dating_App/actions/runs/39723068853)
passed before the M3 branch was created.

## Implemented and reviewed state

M0 was merged in PR #2; M1 was merged in PR #3. M1 implements public pages,
email links, optional passkeys, adult
eligibility/consent, profiles, versioned preferences, optional weekly availability,
private moderated photos, account controls, session management and the operator
audit foundation. It does not implement the introduction-to-meeting lifecycle.

M2 adds immediate bilateral blocking and a single deny policy, guarded profile/photo
reads, independent report/block/help choices, case status, separate integrity review,
encrypted safety storage, an audited safety console, precaution/lift, independent
appeal review and stored account/venue/event/Go shutdown controls. Session/staff
revocation is rechecked under locks at protected operations. Only a safety reviewer
can read cases; admin alone cannot. See [safety operations](operations/safety.md).
DEC-039 adds query-free help links, directional block ownership with preserved
legacy denials, enforced client-version shutdown and an explicit M5 D9 retention item.

M3 adds bilateral eligibility, centroid travel and recurring-window feasibility,
the deterministic stated-fit heuristic, greedy allocation with exact conditional
propensity logs, atomic bilateral reservations, permanent pair history, audited
operator/concierge review, approval outbox and durable jobs. Members have finite
full-page cards, blind decisions, distinct expiry, opt-in reminders, mutual
connections and closure. Delivery grants both profiles; terminal transitions revoke
grants and release slots once. See [Explore operations](operations/explore.md),
DEC-040–043 and [M3 review](testing/m3-review.md).

M4 adds encrypted polling chat, queued delivery, private closure and archive
suggestions, explicit paused-chat consent, operator venue review, stable filtered
venue options, immutable venue/time revisions and bilateral plan confirmation.
Venue edits, review expiry and shutdowns invalidate plans. Calendar/share/manual
messages, chat/plan safety links and the opt-in Focus offer are implemented.
See DEC-046–048 and [M4 operations](operations/connections-plans.md).

The merged M1 repair isolates authentication email failures: each message commits
independently, failed attempts persist with a retry delay and budget, and a corrupt
message cannot undo earlier successful delivery markers. Migration `0004` is
additive and has been applied only to local development/test databases. SMTP
remains at-least-once after an ambiguous send or commit. See the
[delivery runbook](operations/auth-delivery.md) and DEC-030.

The founder-designated 67-page PDF is preserved byte-for-byte. All 193 requirements
and 20 invariant mappings remain tracked. This audit adds a source-backed
[competitor comparison](research/competitive-landscape-2026.md),
[REA evaluation](research/rea-evaluation.md),
[architecture gap analysis](architecture/review-2026-10-20.md),
[roadmap following CODEX_PROMPTS](product/roadmap.md),
[threat model](security/threat-model.md) and
[test strategy](testing/strategy.md).

## Verification and GitHub review

Setup audit on 2026-11-11: `corepack pnpm install --frozen-lockfile` and full
`corepack pnpm check` passed with Node 24.19.0 / pnpm 12.11.2: typecheck, lint,
formatting, 42 unit/property/architecture tests, 70 real PostgreSQL tests,
production build and 15 Chromium/axe tests (127 total). The first run discovered
a missing Playwright browser cache; installing the pinned Chromium restored it.
Services were stopped with local data preserved. Setup PR CI remains to be checked.

M4 full `pnpm check` passed: typecheck, lint, formatting, 42 unit/property/
architecture tests, 70 real PostgreSQL tests, production build and 15 Chromium/axe
workflows (127 total). See [M4 review](testing/m4-review.md) and the M4 PR for
exact-head CI. Migration 0013 has been applied only to local development/test stores.

DEC-045 correction passed full `pnpm check`: 32 unit/property/architecture,
56 real PostgreSQL and 13 Chromium/axe tests (101 total), plus typecheck, lint,
formatting and build. Migrations 0010/0011 remain unchanged; 0012 repairs history
and retains attempts, exposures and an append-only closure ledger.

M3 full `corepack pnpm check` passed: typecheck, lint, formatting, 32 unit/property
tests, 46 real PostgreSQL integration tests, production build and 13 Chromium tests
with axe (91 total). See [M3 review](testing/m3-review.md) and the PR's exact-head
checks for the historical CI results. M3 and M4 are now merged.

Full `corepack pnpm check` passed on the M2 review branch: typecheck, lint, formatting,
22 unit/property tests, 34 real PostgreSQL integration tests, production build and
11 Chromium tests with axe checks (67 tests total, including DEC-039 corrections). Its PR and final handoff record
the exact head and CI results. The tests include real
PostgreSQL role denial, session/staff revocation races, both block/profile orderings,
simultaneous block/report, independent appeal decisions and Chromium/axe workflows.

### Historical M1 verification

Fresh baseline: `corepack pnpm check` passed all 37 original tests.
After this repair, the full command passed again: typecheck, lint, formatting,
**16 unit/property + 18 real PostgreSQL/PostGIS integration + 7 Chromium tests
= 41 tests**, plus the production build. Browser tests use real Mailpit/MinIO,
axe and a virtual passkey. The four new database regressions cover isolated
failures/backoff, eligibility exclusions, concurrent senders and deferred commit
failure/recovery. No whole-process crash or real SMTP vendor test is claimed.
`corepack pnpm audit --audit-level high` reported no known vulnerabilities at
query time. Test counts are not a production safety certification.

PR #3's inspected run [39384006645](https://github.com/abinabrahamColorado/Dating_App/actions/runs/39384006645)
passed `windows`, `dev-services` and `verify`; it had no submitted review. Those
checks validate its old head, not this repair. This branch is published as
[PR #4](https://github.com/abinabrahamColorado/Dating_App/pull/4) targeting the M1
branch. Its initial run 39541603202 exposed a Compose initialization race:
`postgis_version()` was unavailable after the socket health check passed. DEC-032
changes readiness to TCP and retains the SQL assertions. Inspect the final PR head
and live checks before merging; publication and final CI results are recorded in
that PR and the task handoff. The older M0 PR #1 was subsequently closed as
superseded without merging and is not additional work to merge.

PR #4 subsequently merged into M1 with explicit approval. The current M1 merge
review records DEC-033/034, the complete Markdown-rewrite audit, a four-fail/four-pass
auth regression proof and a disposable-database migration upgrade check. See
[M1 merge review](testing/m1-merge-review.md). Final CI is recorded on PR #3 and in
the task handoff. Those task-specific stop instructions were superseded by the
founder's explicit M1 merge and M2 authorization in DEC-035.

## Release limits and next work

Account APIs require local/test mode and a loopback origin. Use synthetic accounts.
Birth-date entry is not identity verification. Chat and joint plans were merged
in PR #8. M5 feedback, metrics and erasure/restore are under verification on their
own branch. Event Go remains unbuilt. No serving model, member
GPS collection, real provider integration or live pilot is enabled.

The approved #11/#9 merges and green-main gates are complete. M5's single PR #22
is open and has passed all six jobs at its completed implementation commit.
Next: confirm checks on any final documentation commit, then await the founder's
review and separate merge approval (DEC-053). M6 is not authorized.
M1 client retry recovery and ambiguous media-write compensation (G08/G09) remain
release gates. M2 fixes G02/G03 for current request/case boundaries; M3 now tests
reservation/delivery/acceptance races. M4 PR #8 proves the chat-delivery and
plan-confirmation block races in both lock orderings.
Deletion/restore must pass before real enrollment; Go also requires staffed
operations and explicit activation approval. The founder rejected the crosswalk;
CODEX_PROMPTS numbering and order govern. M5 deletion already precedes M6 Go.
Ambiguous-send duplicate auth emails are accepted; REA stays uninstalled and
competitor research is complete for now (DEC-033).

Founder choices before launch include name/areas, relationship vocabulary,
age-out/return policy, incident staffing, providers and privacy/retention review.
See [repository audit](testing/repository-audit-2026-10-20.md), DECISIONS and BACKLOG.

## Try the local build

```powershell
Set-Location E:\Buisness\Dating_App
corepack pnpm services:windows:start
corepack pnpm setup:accounts
corepack pnpm dev
```

Open `http://localhost:3000`. Use an address such as `member@synthetic.invalid`;
retrieve the link in `http://127.0.0.1:8025` and open it in the same browser.
Run `corepack pnpm worker` in a second terminal for retries.
See DEVELOPMENT_WINDOWS.md for a synthetic moderator and shutdown instructions.
Ignored `.env` holds generated keys; `.local/` holds services/data.
Local services were stopped after verification, with data preserved.
