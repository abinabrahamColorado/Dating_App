# Codex task prompts

There are eight prompts here, M0 to M7. Run each one as a separate Codex task,
in order. Review and merge each pull request before starting the next. Every
prompt assumes `AGENTS.md` and `docs/architecture-v0.2.txt` are in the repo.

Fill these in before M0:

- [CITY / CATCHMENT]
- [AGE RANGE]
- [3–8 LAUNCH AREAS, each with an approximate centroid you choose]
- [PRODUCT NAME, or "working name"]

---

## M0: Plan, trace and scaffold (no product features)

```
You are the founding engineer on a two-founder startup. The quality bar:
a staff engineer at a top consumer company would approve every pull
request without asking for changes. That means correct state machines,
tested invariants, least-privilege data access, and a calm, accessible
interface. It does not mean extra features.

Read AGENTS.md completely, then read docs/architecture-v0.2.txt from start
to finish. Do not skim. Parts 4-6, 11-13, 15-18, 20-23, 26 and 29 govern
this build. Parts 7-9 (Go, Ghost, geospatial) apply only to the later
event prototype.

Launch facts:
- Catchment: [CITY / CATCHMENT]
- Ages: [AGE RANGE]
- Launch areas: [LIST]
- Name: [PRODUCT NAME]

What we are building first is the spec's MVP (Part 23): a responsive
website that serves as
  (a) a public site,
  (b) the member app for Explore mode,
  (c) an operator console that supports concierge matching and reviewing
      generated batches,
  (d) a background worker.
Event-bound Go comes later, behind a feature flag that is off by default.

This task produces:

1. docs/SPEC_TRACE.md. Number every testable requirement in the spec that
   falls within MVP and event-Go scope (REQ-001...). For each one give:
   the spec part, a one-line requirement, the milestone (M1-M7, as defined
   in CODEX_PROMPTS.md if present, otherwise the plan you propose), the
   module, and the planned test name. Include all 20 invariants from
   AGENTS.md. List out-of-scope items separately with the reason.

2. docs/ARCHITECTURE.md:
   - repo layout
   - module boundaries
   - Postgres schemas and roles
   - the entity-relationship model covering every entity in Spec P22 that
     is in scope, with fields, keys, unique constraints and indexes
   - the state diagrams for account state, discovery intent, nearby
     privacy, the opportunity lifecycle and the plan lifecycle (Mermaid)
   - API route list for /api/v1, with the authorization rule for each route
   - the outbox and worker job design
   - the reservation locking protocol
   - the deletion orchestration design
   For each sensitive field D1-D15 in Spec P22, state whether the MVP
   stores it, where, its retention, and who can access it.

3. docs/DECISIONS.md, containing every ambiguity you found and the
   protective choice you made for each, plus docs/BACKLOG.md.

4. packages/config/src/pilot.ts, holding every numeric pilot setting with
   its spec part. At minimum:
   - MAX_ACTIVE_CONNECTIONS = 3
   - MAX_NEW_INTROS_PER_WEEK = 3
   - EXPLORE_RESPONSE_HOURS = 48
   - ARCHIVE_SUGGEST_DAYS = 7
   - EXPLORATION_EPSILON = 0.10
   - GO_SESSION_MINUTES = 30
   - GO_OFFER_LEASE_MINUTES = 5
   - GO_MAX_NEW_PERSON_OFFERS_PER_SESSION = 2
   - GO_RENEWALS_PER_HOUR = 2
   - PRESENCE_LEASE_SECONDS = 90
   - AVAILABILITY_HORIZON_DAYS = 10
   - VENUE_IMBALANCE_LAMBDA = 0.5
   - VENUE_SUGGESTIONS = 3
   - retention periods from the D1-D15 table
   - BACKUP_EXPIRY_DAYS = 30
   - DELETION_ACTIVE_STORES_DAYS = 30
   Also add feature flags: EVENTS_ENABLED=false, GO_ENABLED=false,
   NEW_PERSON_GO_ENABLED=false.

5. A working scaffold:
   - pnpm workspace containing apps/web, apps/worker, packages/core,
     packages/db and packages/config
   - strict TypeScript, lint and format
   - Postgres + PostGIS, MinIO and Mailpit for local development
     (docker-compose, plus a fallback setup script for environments
     without Docker)
   - the first migration, creating the schemas and roles
   - a CI workflow that runs typecheck, lint, unit, integration and
     end-to-end tests
   - one passing test per package
   - a README covering setup and running

Do not build product features in this task. Stop after the scaffold.
Report in this order:
- the plan for M1-M7 with any changes you recommend
- the ten riskiest requirements and how each will be tested
- open questions for the founders
```

---

## M1: Accounts, onboarding, profiles, public site

```
Milestone M1. Follow AGENTS.md. Spec: P4, P5, P11, P12, P22.

Build:

1. Public site:
   - pages: home, how it works, safety, privacy, apply
   - honest copy only: no fabricated testimonials, member counts or
     success claims
   - apply page: email plus catchment and area check. Outside the
     catchment, show a waitlist message.

2. Accounts:
   - email magic link, optional passkey
   - adult eligibility check at registration, with the birth date stored
     in identity only (I-01)
   - versioned terms and privacy consent records
   - session management, including "sign out other devices"

3. Onboarding, about 3 minutes to a usable profile (Spec P4):
   - Screens: display name; age shown; who you want to meet; relationship
     intention and structure; area (chosen from the launch-area list; no
     GPS) and maximum travel time with transport mode; 5-8 interests as
     tappable chips; one prompt; 2-3 photos.
   - Photos go to the moderation queue. A profile is not discoverable
     until its photos are approved.
   - Show a progress indicator. Allow skipping wherever the spec permits.
     Never hide a mandatory step until after the member has invested
     effort.

4. Preferences (I-02, I-03):
   - ExplicitConstraint and SoftPreference with the three-way setting
   - full version history
   - a settings page where members can review and edit them

5. Availability: weekly windows and a "flexible this week" option.

6. State axes and precedence (I-13):
   - account state: ONBOARDING, ACTIVE, PAUSED, EXITED, RESTRICTED
   - discovery intent: EXPLORE or FOCUS
   - nearby privacy: GHOST by default
   - capacity: derived
   - Pause, Focus and Exit controls, with an optional exit reason that
     includes "I met someone here"
   - account deletion request (orchestration itself comes in M5; here,
     record the request and disable the account immediately)

7. Operator console foundation at /ops:
   - roles: operator, safety_reviewer, admin
   - least privilege per role
   - photo moderation queue
   - append-only audit log (I-20)

Tests:
- I-01, I-02 (eligibility function only), I-03, I-13 and I-19 for these
  routes
- an end-to-end test that completes onboarding in under 3 minutes of
  scripted interaction
- an axe accessibility check on every new page
```

---

## M2: Safety core

```
Milestone M2. Follow AGENTS.md. Spec: P17, P20, P21, P22.

Build:

1. Block (I-04): immediate, in both directions. Expose a single
   isDenied(u, v) policy function that every discovery and delivery path
   must call. Add an architecture test that fails if a discovery or
   delivery path skips it.

2. "Something felt off" flow (I-11), reachable from every place I-11
   lists. It offers, as independent choices: immediate help resources for
   the jurisdiction (configurable), an optional description, block, and
   report. The member gets an acknowledgement and can track the case.

3. Safety schema and role:
   - Report, SafetySignal, Enforcement, Appeal, CaseAccessAudit
   - the reporter's identity is never exposed to the reported member
   - serving code reads enforcement status only (I-12)

4. Operator safety console:
   - case queue with severity levels
   - precautionary restriction, written in neutral wording
   - appeal flow
   - audited access (I-20)
   - Report count alone never triggers an automatic permanent ban.

5. Kill switches in config and the console: disable a venue, an event,
   an account, new-person Go, or all Go. Reporting must keep working
   while any of these are active.

6. Profile integrity: an optional "something important differed from the
   profile" form, routed to integrity review, separate from safety.

Tests:
- I-04 and I-11
- I-12: assert that report text cannot be read from the app or learning
  roles at the database level
- I-20
- the full set of block race tests: block during accept, block during
  plan confirmation, block during outbox delivery
```

---

## M3: Explore engine (the core of the product)

```
Milestone M3. Follow AGENTS.md. Spec: P5, P6, P10, P13, P15, P16.

Implement these in packages/core as pure, property-tested functions.
Persist and run them through packages/db and the worker.

1. Eligibility. eligible(u, v, t) holds only if all of these are true:
   - both members are ACTIVE, in EXPLORE, and not Paused, Focus or
     Restricted
   - both profiles are complete with approved media
   - who-to-meet matches in both directions
   - age is within both members' hard ranges
   - every hard intention, structure and exclusion is met in both
     directions
   - no block in either direction, and isDenied is false
   - the pair key has no live or closed record (I-05)
   - travel feasibility (below) holds for at least one approved venue
   - availability feasibility holds: an overlapping window in the next
     AVAILABILITY_HORIZON_DAYS, or both members are "flexible this week", or
     one is flexible and the other has any window

2. Travel feasibility. Estimate minutes from each member's area centroid
   to the venue by transport mode, using configurable speeds. Label this
   as an estimate in code. The venue must be within both members' maximum
   travel times. Never use or store member coordinates.

3. Heuristic priority. This is NOT a probability (Spec P15), so name it
   statedFitHeuristic. Define it as
       h(u, v) = s(u -> v) * s(v -> u)
   where s(u -> v) is the weighted share of u's soft and strong
   preferences that v's self-description satisfies, with strong weight 2,
   soft weight 1, and attributes v has not stated left out of both
   numerator and denominator. If u has no preferences, s = 1. Never
   display h or anything derived from it.

4. Allocator. This is a greedy b-matching with waiting-time rotation and
   epsilon exploration (Spec P13, P16). For each batch:
   - Build the feasible edge set E over the members who have free slots
     and remaining weekly allowance.
   - Order E lexicographically by
       (coverage priority: days since the less-served endpoint's last
        offer, bucketed by week, descending;
        h descending;
        seeded random tie-break).
   - At step j, F_j is the set of remaining edges whose two endpoints
     both have capacity. With probability 1 - EXPLORATION_EPSILON pick the
     rule-best edge; otherwise pick uniformly from F_j.
   - Log q_j(e) = (1 - eps) * 1[e is rule-best] + eps / |F_j|, together
     with the identifier and size of F_j, the seed and j (I-15).
   - Respect MAX_NEW_INTROS_PER_WEEK and one live proposal per pair.
   - Report unmet demand per member with a reason:
     zero eligible supply / retrieval miss / capacity / paused.
   - Never fill an introduction with an edge that failed a gate.
   - Add an offline benchmark script that compares the greedy result with
     an exact solver on small random graphs.

5. Reservation (I-06, I-09). In one transaction, lock both capacity
   ledgers in ascending user-ID order, apply a compare-and-swap on the
   versions, and create an Opportunity in RESERVED. Release exactly once
   on pass, expiry, block, restriction or close.

6. Operator batch review. The operator sees the proposed batch, which
   members are unserved and why, and can approve, remove or add pairs.
   Every add or edit goes through the same eligibility checks and is
   logged as policy "operator" with unknown propensity (I-15).
   Concierge mode lets an operator create single introductions in the
   same way.

7. Delivery. Approval writes to the outbox. Before sending, the worker
   rechecks eligibility and isDenied, then moves the opportunity to
   PROPOSED. Email notifications are generic.

8. Member experience:
   - one full-page introduction card per opportunity (AGENTS.md section 6)
   - private Accept or Pass, decided in any order within
     EXPLORE_RESPONSE_HOURS
   - expiry is its own state (I-08), with no reminder unless the member
     enabled reminders
   - mutual acceptance moves to MUTUAL and opens a connection
   - truthful empty state (I-16)
   - an at-capacity explanation
   - no swipe gesture, stack or side-by-side comparison view

Tests:
- property tests:
  - no member exceeds capacity
  - no pair is ever proposed twice
  - every proposed edge passes eligibility
  - the q values logged at each step sum to 1 over F_j
  - with a fixed seed the allocator is deterministic
- concurrency tests: two batches racing, accept racing expiry, block
  racing reserve
- I-02, I-05, I-06, I-07, I-08, I-15 and I-16 end to end
```

---

## M4: Connections and meeting coordination

```
Milestone M4. Follow AGENTS.md. Spec: P6, P18.

Build:

1. Connection chat:
   - text messages
   - server-sent events or polling; no third-party chat service
   - no read receipts and no typing indicators
   - either member can close privately; the other sees only "This
     connection has ended"
   - suggest archiving after ARCHIVE_SUGGEST_DAYS without progress
   - capacity is held from proposal to connection and released once
   - a member never has to send a message to unlock anything
   - message content is never used for matching or analytics

2. Approved public meeting places, managed by operators with every venue
   field listed in Spec P18:
   - entrance and hours with timezone
   - accessibility details
   - cost band
   - alcohol-free and no-purchase options
   - transit access
   - partner contact
   - review date and expiry
   A venue past its review expiry is never suggested.

3. Planning:
   - Show overlapping availability windows, or let members propose a
     time when both are flexible.
   - Suggest 3 venues that pass both members' accessibility, budget,
     activity and hours filters. Rank them by
         max(t_u, t_v) + LAMBDA * |t_u - t_v|
     with LAMBDA = VENUE_IMBALANCE_LAMBDA.
   - The suggestion list stays stable while members move; neither origin
     is ever shown to the other member.
   - Versioned plan: both members confirm the same venue and time
     version (I-09). Either can decline, suggest another approved venue,
     or cancel without giving a reason.
   - A venue closure or change invalidates the plan and requires both to
     confirm again. Never reroute silently.

4. Plan page:
   - add-to-calendar file
   - one-tap messages: "I'm here", "Running late", "I need to leave"
   - "Share plan" through the Web Share API or a copy-text fallback,
     containing only venue, time and first name
   - no address-book access and no automatic alerts
   - "Something felt off" is always visible

5. Focus: offer it after a second confirmed plan with the same person.
   It is opt-in and there is no public badge.

Tests:
- I-09 races: two confirmations of different versions, confirmation
  racing a venue closure, cancel racing confirm
- the venue ranking function
- venues with expired reviews are excluded
- end to end: mutual -> plan -> confirmed -> plan page
```

---

## M5: Feedback, outcomes, metrics, deletion

```
Milestone M5. Follow AGENTS.md. Spec: P13, P17, P22, P24, P26.

Build:

1. Feedback (I-10):
   - The morning after the planned time, ask once: "Did you meet?"
     with Yes / No / Prefer not to say.
   - Then ask: "Would you like to see them again?" with Yes / Not sure /
     No / Skip.
   - One optional follow-up offers at most 2 chips from the matching
     list in Spec P17.
   - A discrepancy answer routes to integrity review. Discomfort routes
     to the safety flow.
   - No nagging and no gating.
   - "Invite to meet again" is a separate action that only the inviter
     can trigger.

2. Attendance provenance enum: BOTH_REPORTED, ONE_REPORTED,
   HOST_CONFIRMED_FOR_EVENT, DISPUTED, UNKNOWN. Silence never becomes a
   no-show. Do not build automatic penalties.

3. Learning datasets. Create append-only, separate tables in the learning
   schema for:
   - selection: exposures and decisions, with the I-15 fields
   - experience: categorical outcomes, with missing kept distinct
   - logistics: plans and attendance
   Exclude report text, location, chat content and audit demographics.
   Write an export script that produces time-stamped snapshots and
   respects deletion. Do not train any model.

4. Outcomes: an optional success exit, plus separately consented 30- and
   90-day follow-ups. Non-response is UNKNOWN, never "breakup".

5. Metrics dashboard in /ops. Every metric shows its exact denominator
   and its completeness (both observed / one / neither / contradictory),
   per Spec P26:
   - primary metric: distinct members with a mutually positive reported
     meeting within 28 days, per 100 members of a fixed enrolment cohort
   - follow-through
   - second meetings
   - coverage at 14 days, with the reasons for unserved members
   - attention cost (active minutes per attended meeting)
   - exposure Gini and top-decile share
   - abuse and operations queues
   - the Spec P23 pilot gates, shown as pass/fail against the
     configured thresholds
   Small cells are suppressed.

6. Retention and deletion (I-18):
   - jobs per the D-table retention settings
   - a deletion orchestrator covering primary stores, media and CDN,
     exports, learning snapshots and caches
   - deletion tombstones that are reapplied after a restore
   - a deletion receipt shown to the member

Tests: I-10, I-12, I-18, the metric definitions against fixture cohorts,
and checks that the learning export contains no forbidden columns.
```

---

## M6: Events and the event-bound Go prototype (flags default off)

```
Milestone M6. Follow AGENTS.md. Spec: P5, P7, P8, P9, P19, P20, P21.
Everything in this milestone sits behind EVENTS_ENABLED / GO_ENABLED /
NEW_PERSON_GO_ENABLED. No GPS is used anywhere.

1. Events (Spec P19):
   - A verified organizer creates an event at an approved venue.
   - An operator reviews the time, consent language and conduct plan.
   - Members RSVP.
   - Dating discovery is a SEPARATE opt-in. An RSVP is never romantic
     consent.
   - Check-in uses a rotating host code; record HOST_CONFIRMED_FOR_EVENT
     only when a host confirms.
   - The event candidate pool expires when the event ends.
   - Organizers see only operational attendance. There is never a roster
     of people who opted into dating.
   - An event can never resurface a closed pair (I-05).

2. Go, existing matches first (Spec P7):
   - "Open to a short meeting for the next 30 minutes", inside a checked-in
     event or with an existing mutual connection.
   - Requires: consent version, free capacity, and verification
     appropriate to risk (use the fake vendor).
   - One offer at a time, with a lease of GO_OFFER_LEASE_MINUTES.
   - No counts, dots, distances or "someone nearby" teasers.
   - Mutual -> choose a venue -> navigate by handing the venue address to
     the member's own map app.

3. New-person Go at a dating-enabled event, behind NEW_PERSON_GO_ENABLED:
   - at most GO_MAX_NEW_PERSON_OFFERS_PER_SESSION
   - the full identity card before any decision

4. Nearby off / Stop (I-14, Spec P8):
   - increment the epoch and revoke tokens
   - release unaccepted nearby reservations; cancel queued notifications
   - the client clears nearby cards
   - "Stop nearby and cancel this plan" is a separate action
   - the other person is never told
   - if offline, show a "stopping..." state until the server acknowledges

5. Kill switches from M2 now apply to events and Go.

Tests:
- I-14 races: Stop racing accept, Stop racing delivery, stale-epoch
  retries, worker restart
- an RSVP without the dating opt-in never enters the pool
- an organizer cannot read dating data
- Go cannot start without capacity or with a stale session
- the toggling budget is enforced
```

---

## M7: Hardening and release readiness

```
Milestone M7. Follow AGENTS.md. Spec: P20, P21, P22, P29, P31.

1. Release tests (Spec P21 "Specific release tests"), using adversarial
   synthetic accounts:
   - filter edits, multiple accounts, cached responses, push and email
     timing, venue choice, error text and Go/Stop cycling do not create a
     finer-grained location or presence oracle
   - blocks hold across devices and stale tokens
   - when the authorization store fails, requests are denied
   - no personal data, location or report text appears in logs, traces,
     queues, exports or backups (scan them in CI)

2. An authorization test matrix covering every /api/v1 route x role x
   object ownership (I-19).

3. Graceful degradation per Spec P31. Each of these needs a test:
   - model missing -> rules
   - no capacity -> no proposal
   - authorization failure -> deny
   - venue invalid -> no plan
   - safety coverage unavailable -> no live Go

4. Rate limits and query budgets on every discovery, decision and
   messaging route.

5. A full accessibility audit (WCAG 2.2 AA) and a Lighthouse pass on
   mobile.

6. docs/RUNBOOK.md:
   - incident response
   - using the kill switches
   - deletion requests
   - restoring from backup with tombstones
   - safety-queue staffing hours
   - the vendor list with data flows

7. docs/PRIVACY_REVIEW.md: a data-flow table for every field D1-D15 as
   implemented, with every deviation from Spec P22 listed for counsel.

Finish with a release-readiness report: each Spec P23 gate, each
invariant's test status, known residual risks, and what still needs a
human (legal review, venue checks, staffing).
```
