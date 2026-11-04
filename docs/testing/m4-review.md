# M4 review evidence

Scope: CODEX_PROMPTS M4, Spec P6/P18 and the M2/M3 carry-over requirements for
locked denial, venue shutdown and architecture inventories. The branch is
`codex/m4-connections-plans`. Do not merge its PR or start M5.

## Merge prerequisite

The founder-approved M3 correction passed all six PR/push checks at `d0c1aa7`.
PR #6 merged with merge commit `010a80bc40a96cc0576a0370e6238f9b988e487c`.
Main CI [41772404412](https://github.com/abinabrahamColorado/Dating_App/actions/runs/41772404412)
passed all three jobs before the M4 branch was created. Migrations 0010/0011 were
not edited; the pair-history repair was migration 0012.

## What is implemented

- Encrypted text chat, five-second polling, durable queued delivery, private
  closure, bounded earlier-message reads and an optional archive suggestion.
  Messaging never gates planning. No receipts, typing indicators or text learning.
- Complete human venue review at `/ops/venues`, with public review/access/hour
  fields and private encrypted partner/operational fields. Current staff roles
  and access audits protect the console.
- Private per-connection meeting requirements, shared availability, up to three
  filtered/ranked stable public choices, explicit refresh and immutable plan
  revisions. Both members confirm the same venue/time revision. Changes, closure,
  review expiry and venue shutdown invalidate current plans.
- Plan page, calendar file, voluntary venue/time/first-name sharing, the three
  manual messages and opt-in Focus after two distinct confirmed plans.
- Locked `isDenied` at every new member disclosure/transition. Existing paused
  chat requires the explicit retained-chat choice; discovery stays disabled.
  Reporting/help links survive ended connections and shutdowns.

## Verification

Full local `pnpm check` passed on 2026-11-03: typecheck, lint, formatting,
42 unit/property/architecture tests, 70 real PostgreSQL/PostGIS tests, production
build and 15 Chromium/axe workflows: **127 tests**. CI remains an independent
exact-head gate; the PR records its final run links.

PostgreSQL barriers prove both orderings of block during delivery and confirmation,
and both orderings of venue closure versus confirmation. Other tests cover
different-revision confirmation, cancel versus final confirmation, stale sessions,
operator revocation, private DTOs, learning/app role isolation, same-key retries,
capacity release, stable choices, expired reviews and actual pg-boss execution.
The maintenance test simulates review-time passage in its isolated database and
verifies invalidation by the real worker. No mock database replaces these tests.

Property tests check the specified travel ranking under input permutations. Pure
tests cover bilateral cost/access/activity/hour/alcohol rules, short availability,
DST gaps/folds, midnight opening boundaries and calendar escaping. Architecture
tests fail when any required guard is removed or a new route/job is unclassified.
The dispatcher and worker changes were reviewed before updating their sealed hashes.

Browser tests cover operator review, mutual -> plan -> both confirmations without
chat, plan page, calendar download, copy sharing, manual messages, conversation,
private close, venue shutdown, block and continuing help/report access. Axe runs
on the new pages and mobile overflow is checked. Screenshots are synthetic local
test artifacts, excluded from source control.
The confirmed desktop plan, mobile conversation and complete operator review form
were visually inspected; controls and text wrap without overlap or horizontal overflow.

Initial browser runs found two harness issues (axe context setup and an ambiguous
text selector), then a real midnight-hours filtering defect. The hours filter now
checks every occupied civil minute across day/DST boundaries; its regression and
the full browser workflow pass.

The first Linux CI run exposed a browser assertion whose five-second deadline
matched the five-second chat poll timer. The test now proves HTTP acceptance and
database delivery separately, then checks a stationary recipient through normal
polling within two configured poll intervals. Connection closure uses the same
poll-aware assertion. Delivery keeps its original five-second assertion; no
production timer or delivery rule changed.

## Decisions and limits

DEC-046 covers authority, private closure and consent revisions. DEC-047 covers
protective meeting defaults, venue privacy, stable choices and catalog lock order.
DEC-048 covers time/share behavior and release boundaries. M4 implements all
chat-delivery and plan-confirmation block races previously deferred from M2.

M5 retains feedback, post-meeting surfaces, D9/D11/D12 retention, legal holds and
deletion/restore. Generic opted-in plan reminder delivery and production process
key isolation remain release work in M7. No automatic emergency messages, Go,
third-party chat/maps, real venue approvals or matching research cards were added.
Founder release questions remain venue inventory/review ownership, safety staffing,
privacy/retention review and validation of the pilot duration/preferences defaults.
