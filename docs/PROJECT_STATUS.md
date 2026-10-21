# Project status

Updated 2026-10-20 (America/Chicago). Working name: **Meetwell**.
Pilot proposal: Manhattan, New York City; ages 18–30.

Permanent checkout: `E:\Buisness\Dating_App`.
Remote: `https://github.com/abinabrahamColorado/Dating_App`.
Current review branch: `codex/m1-audit-auth-delivery`, based on M1 head `3cc38d7`.

## Implemented and reviewed state

M0 was merged in PR #2; remote main is `16676f3`. M1 PR #3 remains open and
unmerged. M1 implements public pages, email links, optional passkeys, adult
eligibility/consent, profiles, versioned preferences, optional weekly availability,
private moderated photos, account controls, session management and the operator
audit foundation. It does not implement the introduction-to-meeting lifecycle.

This review branch isolates authentication email failures: each message commits
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
[milestone crosswalk](product/roadmap.md),
[threat model](security/threat-model.md) and
[test strategy](testing/strategy.md).

## Verification and GitHub review

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
that PR and the task handoff. The older open M0 PR #1 is a conflicting historical proposal and must
not be mistaken for additional work to merge.

Nothing was merged, deployed, force-pushed or deleted in this audit. The founder's
current directive requires explicit merge authorization (DEC-029). M2 starts
after M1 review and an approved merge.

## Release limits and next work

Account APIs require local/test mode and a loopback origin. Use synthetic accounts.
Birth-date entry is not identity verification. Deletion currently disables access;
it does not erase data. Blocking/reporting/appeals, allocation, chat, joint plans,
feedback, erasure/restore and event Go remain unbuilt. No serving model, member
GPS collection, real provider integration or live pilot is enabled.

Next: review the M1 repair; then implement M2's independent block/report and
reviewer-audit slice. Session/staff revocation races, client retry recovery and
ambiguous media-write compensation (G02/G03/G08/G09) remain release gates.
Deletion/restore must pass before real enrollment; Go also requires staffed
operations and explicit activation approval. The proposed numbering crosswalk
preserves existing milestone IDs rather than postponing privacy work (DEC-031).

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
