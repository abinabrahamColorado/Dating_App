# Verification strategy and evidence boundaries

Updated 2026-10-20. Use synthetic adults and isolated real PostgreSQL/PostGIS;
an unavailable database is a failure, never a skipped green test.

| Layer                  | Current evidence                                                                                                        | Next expansion                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Pure unit/property     | 16 tests: account rules, hard boundaries/state transitions, config/docs/infrastructure contracts and media sanitization | M2 policy combinations; M3 feasible graphs, allocation, ledger properties |
| PostgreSQL integration | 18 tests after this repair: roles, migrations, pg-boss, accounts/media/CAS and four delivery failure/race cases         | Safety isolation, pair holds, block/accept/expiry races, deletion/restore |
| API/browser            | 7 Chromium tests: real Mailpit/MinIO onboarding, route/owner checks, moderation, passkey, axe/keyboard/mobile           | Stable retries after lost responses, reports, plans, revoked disclosures  |
| Human/operations       | No completed independent security review or manual assistive-tech audit                                                 | Screen reader/usability, incident/restore drills, venue/staff readiness   |

Counts are regression suite size, not requirement completeness or a safety score.
See SPEC_TRACE for the distinction between implemented invariant components and
unbuilt full flows. Empty callbacks in media repository fixtures isolate S3 I/O;
browser tests exercise real private storage. No SQLite substitutes for SQL locking.

Run the documented Windows bootstrap once from DEVELOPMENT_WINDOWS.md. For an
existing installation, in PowerShell at the repository root:

```powershell
try {
  corepack pnpm services:windows:start
  if ($LASTEXITCODE -ne 0) { throw 'Service startup failed' }
  corepack pnpm setup:accounts
  if ($LASTEXITCODE -ne 0) { throw 'Local setup failed' }
  corepack pnpm check
  if ($LASTEXITCODE -ne 0) { throw 'Quality gates failed' }
} finally {
  corepack pnpm services:windows:stop
}
corepack pnpm audit --audit-level high
```

Do not run Next.js type generation/build concurrently in one checkout. CI runs
Windows native services and Linux real-database/browser verification, plus Compose
service health. Recheck the precise PR head, not merely a previous green badge.

Concurrency tests use distinct PostgreSQL connections and controlled barriers,
not sleeps as ordering assertions. The new mail test installs a deferred constraint
trigger on its synthetic row to fail COMMIT after SMTP acceptance, then removes it
in `finally`; real role permissions and transaction state are asserted. It proves
that earlier commits survive and duplicate SMTP can occur on recovery. It does
not claim actual worker-process termination was tested. Retain that separate test
for production delivery hardening.

Future acceptance must cover retries, timeouts, process death, partial commits,
duplicate job delivery and unauthorized reads. Tests verify resulting durable state
and forbidden outcomes. Test data should be isolated/cleaned by fixture ownership;
repeated local runs can exhaust the real global auth budget. Do not weaken product
limits to make a test green. Use a fresh isolated synthetic database or wait for its
test window, recording which was done.

Automated axe does not establish WCAG conformance; scripted onboarding timing does
not measure comprehension. A dependency audit reports known advisories at query
time; it is not a security certification. Secret scans must avoid printing secrets.
