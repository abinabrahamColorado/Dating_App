# M2 review evidence

Spec P17/P20/P21/P22; I-04/I-11/I-12/I-20, with dependent I-19 revocation repair.
Branch: `codex/m2-safety-core`, based on main merge `a4dee47`.

## Merge prerequisite

The founder approved PR #3's merge commit. Main run
[39547453037](https://github.com/abinabrahamColorado/Dating_App/actions/runs/39547453037)
passed `windows`, `verify` and `dev-services`. PR #1 closed unmerged with the exact
comment `Superseded by #2.`. M2 is a separate review PR; it is not approved to merge.

## Local complete check

2026-10-21, native Windows PostgreSQL 16/PostGIS, MinIO, Mailpit and Chromium:

```text
corepack pnpm check
typecheck                 PASS
lint                      PASS
format:check              PASS
unit/property             21 passed (9 files)
PostgreSQL integration    31 passed (4 files)
production Next.js build  PASS
Chromium E2E + axe        10 passed
Total                     62 passed
```

The 13 M2 integration tests cover bilateral denial, object grants, independent
report/block/status paths, physically removed subject member/profile rows, restricted
reporters, all shutdown scopes, SQL role denials, encrypted detail, integrity separation,
append-only case audit, revoked role/session, independent appeals, stale version checks,
restriction persistence after Exit, authorization-store failure and deterministic races.
Block/profile tests exercise both orderings, and block/report commits concurrently.
Separate races prove staff/session revocation waits for an active protected read and
rejects later requests. Tests use real PostgreSQL locks, not timing-only mocks.

Three new Chromium journeys cover public help; profile/settings entry points;
optional description; report acknowledgement/status; loss of a successful submission
response and idempotent retry; bilateral profile/photo denial; post-deletion reporting;
separate integrity queue; audited console; precaution; appeal/lift by an independent
reviewer; shutdown controls; staff revocation; and axe checks on every new page.

Failures found and fixed during development: a subject-deletion fixture retained an
M1 receipt FK; random-key integration cases polluted the browser queue; an alert/queue
selector was ambiguous; and switching console queues could retain old case buttons
until the new response arrived. Fixtures now retire their own records, selectors use
the intended accessible roles, and refresh/case request sequences discard stale UI
responses. Tests were rerun after the fixes; no failing check was disabled.

## Scope, data and migration review

Migrations 0005–0008 add authorization lock functions, safety tables, deny/grant storage,
audit indexes/action and independent-appeal provenance. They apply through the immutable
migration runner on existing M1 development/test schemas; all earlier migration bytes
remain unchanged. No production database was touched. No table or existing member
data is dropped. The audit action constraint is expanded, preserving M1 audit entries.

Runtime app/learning/identity/ops roles cannot select safety report text or other case
tables. Serving obtains one enforcement boolean, with fixed definer search path and
PUBLIC execution revoked. Safety descriptions are encrypted under their own key.
Source review and scans found no generated keys/passwords, provider-token patterns,
real member records, uploaded photos, dumps or unrelated binary data in the change.
All fixture emails use reserved synthetic domains. Runtime `.env`, `.local` and traces
remain ignored. The authoritative PDF, extracted text and CODEX_PROMPTS are unchanged.

## Limits and next review

DEC-036: M2 creates no discovery/intro producer. Cross-member reads require a recorded
grant, supplied only by synthetic fixtures today; M3 will create grants with real
introductions. Immediate denial orders transactions; previously delivered content cannot
be recalled. Static architecture tests and explicit inventories support human review.

DEC-037: only assigned safety reviewers can review cases; appeal decision maker must
be independent. Fine-grained case assignment remains a pre-release operations decision.
DEC-038: support hours, staffing and escalation are unconfirmed; venue/event enforcement
waits for M4/M6. M2 retry keys survive retries in the open page, not browser reloads.

Deferred races: M3 reservation/acceptance/introduction delivery and outbox; M4 chat
delivery and plan confirmation. No placeholder versions were built. G01 worker wiring,
broader G08 M1 retry recovery, G09 media-write compensation, M5 erasure/restore and M7
hardening remain in BACKLOG. The later authorization and verification below govern
the M2 merge and M3 start.

## Founder review corrections (DEC-039)

The founder conditionally authorized the M2 merge after four corrections and green
CI, then M3 after green main CI. Canonical help URLs have no tracking query; 0009
records directional blocks while preserving unknown historical denials separately;
CLIENT_VERSION is enforced by the HTTP gate and controlled from the console; D9
24-month post-closure retention and legal holds are explicitly M5 backlog work.
No prior migration or source architecture was edited.

The complete local `pnpm check` passed again: typecheck, lint, formatting, 22 unit
tests, 34 real Postgres integration tests, production build and 11 Chromium/axe
tests (67 total). A disposable real database proves upgrade from 0008 preserves
legacy denials and accepts independent directional rows with a pair index. SQL
permissions reject runtime removal or reassignment. HTTP tests prove a disabled
client is refused ordinary activity while reports, case status and public help work.

An initial browser assertion expected an old report view in the first audit page;
the new tests generated enough audit rows to paginate it out. It now checks the
most recent integrity view; the same test still verifies the specific report-view
row in Postgres. The complete suite passed after the correction. Exact remote
head, CI and merge evidence are recorded in PR #5 and the task handoff.
