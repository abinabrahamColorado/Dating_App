# AGENTS.md: Human Connection Platform

These are standing rules for every task in this repository. Read this file, then
`docs/architecture-v0.2.txt`, before you write or change anything. If anything
else conflicts with this file or the spec, stop and say so.

The founder's 2026-10-20 execution directive governs authorization: do not merge
PRs, force-push shared branches, delete branches, deploy, run irreversible
production migrations, or change consequential product/privacy behavior without
explicit approval. Prepare a concrete reviewed change first. Ordinary reversible
development fixes remain authorized. See DEC-029 and DEC-033. The founder rejected
the roadmap crosswalk: use the numbering and order in `CODEX_PROMPTS.md` exactly.
Deletion and operational readiness must precede real users or Go. Preserve the PDF.

Never run blanket regex rewrites over documents. Make explicit, reviewed edits
and verify numbers, times, versions, identifiers, URLs and quotations unchanged
unless that specific content change is intended and authorized (DEC-034).

## 1. What we are building

This is a web-first local introduction and meeting service. It gives members a
small number of mutually eligible introductions. Each one is tied to a feasible
next step: a mutual chat, a plan at an approved public venue, a real meeting,
and optional private feedback. Success means members meet people they want to
see again, and eventually leave because they found someone. Uninstalling for
that reason is a success, not churn.

The first build is a responsive website that is also the member app. It
contains:

- a public site
- the member app (Explore mode)
- an operator console
- a background worker

The native mobile app comes later and will reuse the same versioned HTTP API.
Because of that, domain logic must never live in UI components.

## 2. Source of truth

- `docs/architecture-v0.2.pdf` is the founder-designated authoritative product
  and engineering specification. Read its extracted text in
  `docs/architecture-v0.2.txt`, and inspect the PDF for diagrams or layout-sensitive
  meaning. The PDF wins if extraction differs. Preserve both source files;
  record justified implementation improvements in `docs/DECISIONS.md`.
  Cite it in code and tests as `Spec P<n>`. For example, `Spec P5` is Part 5,
  the modes and state machine.
- Where the spec states a numeric value (caps, timers, retention), treat it as
  a **pilot hypothesis**. Each one lives in `packages/config/src/pilot.ts` with
  a comment naming its spec part. Never hard-code these values elsewhere.
- If the spec is ambiguous or silent:
  1. Choose the option that best preserves consent, privacy and safety.
  2. Record the choice in `docs/DECISIONS.md` (date, question, choice, reason,
     spec part).
  3. Continue working.
- If the spec conflicts with itself, record it in `docs/DECISIONS.md`. Then
  apply the more protective reading.
- `docs/SPEC_TRACE.md` maps every requirement ID to its spec part, the module
  that implements it, and the test that proves it. Keep it current in every
  task.

## 3. Stack

Use current stable versions and pin exact versions in the lockfile. Do not
change the stack without a recorded decision.

- **Language and repo:** TypeScript in strict mode, pnpm workspaces.
- **`apps/web`:** Next.js (App Router). It contains the public site, the member
  app and the operator console under `/ops`. JSON API route handlers live under
  `/api/v1`.
- **`apps/worker`:** a Node worker that uses pg-boss on the same Postgres. It
  runs:
  - the weekly batch
  - outbox delivery
  - expiries
  - retention and deletion jobs
- **`packages/core`:** pure domain logic with no I/O. It contains:
  - state machines
  - eligibility rules
  - the scoring heuristic
  - the allocator
  - venue selection
  - policy checks
- **`packages/db`:** the PostgreSQL 16 + PostGIS schema, SQL migrations, and
  repositories using Drizzle ORM. Write raw SQL wherever row locks or
  compare-and-swap are needed.
- **`packages/config`:** pilot settings and feature flags.
- **Database:**
  - Use real PostgreSQL with PostGIS everywhere, including tests.
  - Never substitute SQLite or an in-memory fake, because the invariants
    depend on row locks and transactions.
  - If Docker is unavailable in your environment, install Postgres and PostGIS
    with the system package manager in the setup script.
- **Auth:** email magic link plus optional passkey. Sessions are stored in the
  database. Re-authenticate before sensitive changes: email, deletion, safety
  settings.
- **Media:**
  - Store files in S3-compatible storage (MinIO in development).
  - Strip EXIF and location metadata on upload.
  - Photos go to a moderation queue before anyone else can see them.
- **Email:** an adapter with a development mailbox (Mailpit). Every
  notification is event-driven. Email bodies are generic and never contain
  identities or location clues (`Spec P8`).
- **Tests:**
  - Vitest for unit and integration tests, run against a real database.
  - Playwright for end-to-end tests.
  - fast-check for property tests of the allocator and the state machines.
- **External vendors** (identity verification, maps, payments):
  - Each sits behind an interface with a working fake.
  - Do not integrate a real vendor unless a task explicitly asks for it.
- **Database schemas and access:**
  - Use separate Postgres schemas, each with its own database role: `identity`,
    `app`, `safety`, `learning`, `ops`.
  - The `safety` schema is readable only by the safety role.
  - Serving code reads only the enforcement status of a case, never its
    narrative.
  - The `learning` schema never contains location data, report text or
    sensitive audit demographics.

## 4. Invariants

Each invariant needs at least one automated test, named with its ID (for
example `it('I-07 ...')`). A task is not done if any of these tests fail.

| ID | Invariant | Spec |
|---|---|---|
| I-01 | Adults only. Birth date is stored only in `identity`. Profiles show the age, never the birth date. | P4, P22 |
| I-02 | Eligibility is checked in both directions: each person's who-to-meet setting, age limits, required intentions and every hard exclusion. A learned value never overrides an explicit boundary. | P11, P12 |
| I-03 | Every preference has three settings: "Only introduce within this boundary" (hard), "Strong preference, open to others", "No preference". The original statement is never overwritten. Every edit is versioned with source `USER`. | P11, P12 |
| I-04 | A block takes effect immediately, in both directions, across every discovery path. Blocks are rechecked at retrieval, reservation, delivery, acceptance and plan confirmation. The blocked person is never told. | P5, P20 |
| I-05 | A pair has one unordered pair key. A pass, block, expiry-close or ended connection permanently prevents that pair being introduced again by any route: Explore, events, Go, or a changed radius or mode. | P5, P10 |
| I-06 | Capacity: at most `MAX_ACTIVE_CONNECTIONS`. A reservation holds a slot for both members atomically. Locks are taken in ascending user-ID order inside one transaction. Each reservation is released exactly once. Accepting an offer that already holds a slot never fails for lack of capacity. | P5, P6, P16 |
| I-07 | Decisions are blind and private. Neither person sees the other's choice until both accept. A pass is never revealed. There is no like count and no "likes you" view. | P4, P6 |
| I-08 | An expiry is recorded as a distinct state, never as a pass or a negative label. An archived connection is distinguishable from a rejection. | P6, P13 |
| I-09 | Every consequential transition is a compare-and-swap on a versioned row, with an idempotency key. A plan commits only when both members have confirmed the same venue and time version. A venue change or closure invalidates the plan. | P5, P18 |
| I-10 | Feedback is optional and private. It never gates introductions, refunds, reporting or deletion. A mutual Yes is never revealed automatically; "Invite to meet again" is a separate action. Neither person ever sees the other's answer or reason chips. | P17 |
| I-11 | "Something felt off" is reachable from the profile, chat, plan, post-meeting card, settings and after an unmatch. Reporting does not require blocking, and blocking does not require reporting. A member can still report after the other account is gone. | P17, P20 |
| I-12 | Safety reports, integrity signals, reliability events and matching feedback are stored and routed separately. Report text never enters the `learning` schema, logs or analytics. | P13, P20, P22 |
| I-13 | Account state, discovery intent and nearby privacy are separate fields with enforced precedence: Exited / Restricted / Paused, then Focus, then capacity, then Ghost. The server is authoritative. | P5 |
| I-14 | Nearby off (Ghost) increments `policy_epoch`, revokes every session token, releases unaccepted nearby reservations and cancels queued nearby notifications. Any read or write carrying an old epoch is rejected. If the authorization store fails, the request is denied. | P8 |
| I-15 | Exposure logging: every delivered introduction records the policy version, feature snapshot version, retrieval source, the feasible set's identifier and size, the random seed, the step and the conditional choice probability `q`. Introductions created or edited by an operator are logged as a separate policy with unknown propensity. | P13 |
| I-16 | When there are no introductions, the member sees the truth. Introductions are never padded with a pair that fails a safety, consent or feasibility check. | P4, P6 |
| I-17 | No precise location is stored anywhere in the MVP. Members choose an area from a curated list. Raw coordinates never appear in the database, logs, queues, analytics or error reports. | P9, P22 |
| I-18 | Deletion: an orchestrated job removes data from primary stores, caches, media, exports and learning snapshots within the configured period. A database restore reapplies deletion tombstones before serving any request. | P22 |
| I-19 | Every endpoint authorizes the specific object and field requested. Guessable or sequential IDs never grant access. Public IDs are random. | P22 |
| I-20 | Operator and safety-staff access to cases and to members' private data is written to an append-only audit log, and the log can be reviewed. | P20, P21 |

## 5. Never build these

Never build these unless a later spec version and a recorded decision
explicitly allow it (`Spec P29`):

- **Feeds and engagement mechanics:** infinite or swipe feeds, like inboxes,
  "likes you", streaks, boosts, paid exposure, read receipts, fake scarcity or
  countdowns, refresh rewards, re-engagement notifications.
- **Scores and ratings:** compatibility percentages, match scores shown to
  members, public ratings, reviews of people, attendance badges, leagues,
  desirability ranks.
- **Location and tracking:**
  - nearby radar, distance bands, directions to a person, counts of nearby or
    compatible people
  - crossing histories or location history
  - endpoints shaped like `/nearby?lat=&lng=`
  - user search by phone or email
- **Inference about people:** race, ethnicity, caste, religion, sexuality or
  personality inferred from photos, names or behaviour. No camera-roll access.
  No contact-graph ranking.
- **Premature machine learning:**
  - any learned model in the serving path
  - embeddings, feature stores, online Bayesian updates
  - AI-written romantic messages
  - The MVP logs data that can train models later. It does not train or serve
    any.
- **Mandatory flows:** mandatory feedback surveys, mandatory trusted-contact
  sharing, automatic "no reply means alert someone" emergency features.

## 6. Experience and copy rules

- The tone is calm, plain and human. Do not use gamification or slot-machine
  motion. A short animation is acceptable only when a real state change
  happened.
- Show photos and enough context before a decision. Never require anyone to
  travel to meet someone they have not been able to recognise and question.
- The introduction card shows:
  - photos
  - name and age
  - intention
  - a few interests
  - one prompt
  - optionally, one short line of facts both people stated
  - Never show an inferred trait or a number.
- Copy for an empty week: "No available introduction right now. Next
  introductions: <day>." Never say or imply that nobody wants the member.
- Accessibility: meet WCAG 2.2 AA, work with keyboard and screen reader, honour
  reduced motion, use 44 px touch targets, and design mobile-first.
- Use labels exactly as given: "Nearby off" (with Ghost only as secondary brand
  language), "Something felt off", "Approved public meeting places" (never
  "Safe Zones").

## 7. How to work

1. Start every task by restating the goal in five lines or fewer. List the
   spec parts and invariants it touches. Write a short plan, then execute it.
2. Keep each task to its milestone. If you find work that belongs to another
   milestone, record it in `docs/BACKLOG.md` instead of doing it.
3. Shipped code paths contain no stubs, `TODO`s or placeholder functions. An
   adapter for an external vendor must come with a working fake.
4. Put domain rules in `packages/core`, written as pure functions with
   property tests. Database code must not contain business rules that are
   missing from `core`.
5. Migrations are forward-only and reversible where possible. Seed data is
   synthetic, describes adults only, and never resembles a real person.
6. Logs never contain personal data, message content, report text or anything
   about location. Use structured logs with request IDs.
7. Before finishing a task:
   - Run typecheck, lint, all unit and integration tests, and the end-to-end
     tests affected by the change.
   - Paste the summary output.
   - Update `docs/SPEC_TRACE.md`, `docs/DECISIONS.md` and `docs/BACKLOG.md`.
8. End each task with:
   - what you built
   - test results
   - any spec deviations, with the decision ID for each
   - open questions for the founders
   - what you deliberately did not build
