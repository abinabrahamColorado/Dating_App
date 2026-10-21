# M2 safety operations

Spec P17/P20/P21/P22; DEC-035–038. Synthetic loopback development only.

## Member paths

The profile preview and settings link to “Something felt off.” A subject-specific
profile keeps the link even when its data becomes unavailable. Help, report, block
and optional integrity reporting are separate actions. Reports can omit both the
subject reference and description; submission never adds a block. Blocking never
creates a report or sends a notification. `/safety/cases` lists the signed-in member's
statuses and account appeal controls. Subject deletion never cascades into reports.

`/safety/help` is public, jurisdiction-configured and available without the database.
It lists verified NYC emergency and US crisis resources. No support hours or emergency
response time is promised. Confirm human coverage and escalation before real use.

## Reviewer setup and operation

Run `corepack pnpm setup:accounts` with local services running. It migrates development
and isolated test databases and preserves existing keys. Never print or commit `.env`.
Grant a registered synthetic account `safety_reviewer` with `pnpm staff:grant`; revoke
with `pnpm staff:revoke`, using its UUID or synthetic email. Admin/operator roles do
not imply safety access. Both local administrative actions are audited.

At `/ops/safety`, use the safety and integrity queues separately. Queue entries show
severity and age. Opening a case writes CaseAccessAudit before returning detail.
Update status/severity with its current version. Apply a precaution only after human
review; use neutral wording and preserve appeals. A restriction can be lifted directly
or after appeal review by a different reviewer from the challenged decision maker.
An appeal for an older enforcement version cannot undo a newer
restriction. Direct account controls require an authorized operational account reference.

Go configuration remains disabled. Console shutdowns add a stop, never override a
configuration disable. Venue/event shutdown references are stored now; enforcement is
M4/M6 work. Reporting/help do not consult these switches. Access audit review is itself
audited. There is no report-count ban, public rating, narrative export or analytics feed.

## Boundaries, concurrency and failure

Runtime safety SQL and its encryption key are separate from app/learning/ops roles.
Serving uses only the narrow enforcement boolean. Database administrators still own
the schemas; operational separation and production KMS/backup controls require later
review. The modular monolith is not a claim of process-level isolation.

Session locks and current staff-row locks span protected work. Revocation returns
after earlier protected operations finish; stale sessions/roles fail on the next
operation. Profile/photo reads and block/restriction writes share sorted member locks.
Once a block commits, new reads deny both directions with the same unavailable response.
Previously delivered/in-flight authorized content cannot be recalled. There is no
cached permit. A database error fails closed with a generic request ID, never detail.

M2 has no discovery or introduction generator. Cross-member profile reads require
explicit unexpired grants. Tests provision synthetic grants; M3 will create grants
with real introductions. Do not add a general member search or grant-writing endpoint.
The architecture test rejects new unclassified routes/jobs and policy bypasses.

M2 retries reuse command keys while the page stays open. After reloading during an
uncertain submission, check the case list before resubmitting. No narrative is saved
to browser storage. Logs contain only fixed event names and request IDs. Test traces
contain synthetic data only and are not production telemetry.

## Required review before release

Name the incident lead, trained reviewers, staffed hours, severity/escalation process,
appeal independence and evidence/retention policy. Decide jurisdiction coverage and
verify any additional local resources. Complete M5 erasure/restore and M7 security,
manual accessibility and operational readiness before live enrollment or Go.
M2 authorizes the assigned safety role for case review; finer per-case assignments
and workload/escalation routing remain a pre-release operations design item (REQ-150).

Deferred block races: M3 retrieval/reservation/acceptance/product-outbox delivery;
M4 chat delivery and plan confirmation. Current tests cover block/profile reads,
block/report concurrency, role/session revocation, SQL privilege isolation and browser
accessibility. No fake chat, plan, introduction or notification handler exists in M2.
