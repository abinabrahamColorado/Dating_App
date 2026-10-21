# Execution roadmap — CODEX_PROMPTS order

Updated 2026-10-20. This expands the existing BACKLOG and CODEX_PROMPTS acceptance
contracts; it does not renumber requirements or rewrite the authoritative PDF.
`Implemented` means code exists; `verified` means named checks passed at a stated
revision; `complete` also requires review and the applicable merge/operations gates.
Complexity is relative engineering uncertainty, not a delivery-date promise.

## Approved numbering and order

The founder rejected the crosswalk (DEC-031). CODEX_PROMPTS.md defines the sequence:

1. M0 — Plan, trace and scaffold (no product features).
2. M1 — Accounts, onboarding, profiles, public site.
3. M2 — Safety core.
4. M3 — Explore engine (the core of the product).
5. M4 — Connections and meeting coordination.
6. M5 — Feedback, outcomes, metrics, deletion.
7. M6 — Events and the event-bound Go prototype (flags default off).
8. M7 — Hardening and release readiness.

Deletion and operational readiness before any real users or Go are approved
(DEC-033). M5 already precedes M6; the requirement does not renumber or reorder
milestones. A concierge study under PDF P23 also needs secure tooling, reporting,
erasure and staffed operations. These are release gates, not approval to recruit.

## M0 — Engineering foundation

- **Story/functional:** an engineer can clone, initialize local services, run the
  website/worker and trace each requirement.
- **Nonfunctional/architecture:** strict TypeScript monolith/workspaces, reproducible
  Windows/Linux setup, real PostgreSQL 16/PostGIS; pure core and separate schema roles.
- **DB/API:** migration 0001 boundaries and immutable migration ledger;
  `/api/v1/health` exposes only liveness.
- **Security/tests:** least-privilege role probes, migration replay/drift rejection,
  durable worker health job, config/docs checks, build and browser smoke.
- **Acceptance/dependencies/complexity:** clean setup and gates pass; requires local
  runtimes/services; Medium. Native installer coverage is platform-specific.
- **Evidence:** PR #2 merged at main `16676f3`; M0_REPORT preserves original history;
  current baseline reran foundation tests. No product matching shipped in M0.

## M1 — Accounts, onboarding and preference authority

- **Story/functional:** an eligible adult registers, gives versioned consent,
  creates a recognizable profile, states boundaries, gets photos reviewed and
  can pause/focus/exit/request deletion or manage sessions.
- **Nonfunctional/architecture:** mobile-first accessible UI, encrypted private
  data, loopback synthetic enrollment only, stable recoverable commands.
- **DB/API:** migrations 0002/0003 and repair 0004; current contracts are enumerated
  in ARCHITECTURE.md. `/auth/*`, `/me`, `/profile`, `/preferences`, `/photos`,
  `/account/*`, `/ops/photos` and `/ops/audit` enforce owner/role/field checks.
- **Security/tests:** adult DOB isolation, single-use/browser-bound links, WebAuthn
  origin/challenge/verification, immutable preferences, no self-moderation;
  PostgreSQL races, real Mailpit/MinIO E2E, axe and virtual passkey.
- **Acceptance/dependencies/complexity:** M0, Medium–High. Tests plus reviewed PR;
  automated onboarding speed is not a human comprehension study. Preserve release
  blockers G02/G03/G08/G09 rather than declaring production readiness.
- **Evidence:** PR #3 at `3cc38d7`, baseline 16 unit + 14 integration + 7 browser tests
  passed anew. This audit adds four auth-delivery regressions on a stacked branch;
  review both before an explicitly approved merge. M1 is implemented, not merged.

## M2 — Blocking, reporting, enforcement and appeals

- **Stories/functional:** members can block independently, report from existing
  surfaces and after separation, view permitted case status and appeal restrictions;
  assigned reviewers can act with an immutable audit. Operators control kill switches.
- **Nonfunctional/architecture:** deny by default, no reporter inference, no safety
  narratives in serving/learning; separate durable enforcement from account lifecycle.
- **DB:** unordered pair deny/closure keys; encrypted reports/cases, case assignment,
  enforcement/version projection, appeals and access audit; least-privilege roles.
- **API proposal:** idempotent `POST /blocks`, `POST /reports`, `POST /appeals`;
  own minimized status reads; assigned-reviewer case commands with version/receipt;
  explicit role-gated kill-switch command. Exact route names reconcile with the
  existing architecture contract before implementation; no bulk narrative endpoint.
- **Security/tests:** I04/I11/I12/I19/I20, report without block, block without report,
  cross-role/object denials, restricted/exited report access, duplicate submissions,
  reporter confidentiality and concurrent restriction/available-transition races.
- **Acceptance:** functional UI backed by real cases; no unsafe state reachable in
  available paths; future chat/plan reachability tested when those paths exist.
- **Dependencies/complexity/evidence:** reviewed+approved M1 merge, High. Not built.
  Completion requires migrations/APIs/UI, PostgreSQL authorization/race tests,
  accessible E2E and green CI—not placeholder future handlers.

## M3 — Feasible reciprocal introductions

- **Stories/functional:** eligible members receive at most the configured finite
  batch; each can privately accept/pass, mutual acceptance opens a connection;
  unserved members receive honest explanations without revealing another choice.
- **Nonfunctional/architecture:** deterministic replay, bounded candidate work,
  fairness diagnostics; hard eligibility precedes heuristic ranking and allocation.
- **DB:** unordered pair lifecycle, capacity ledger/atomic bilateral holds,
  opportunity/decisions, feature/policy/exposure snapshots and transactional outbox.
- **API proposal:** own finite introduction list/detail; versioned idempotent decision
  command; minimized connection read. No like inbox or arbitrary user search.
- **Security/tests:** I02/I04–I08/I15/I16; opposite lock ordering, simultaneous last-slot
  allocation, accept a held last slot, block/accept/expiry races, exact-once release,
  repeat No across routes, partial worker failures, `q` and feasible-set replay.
  Compare heuristic output with exact small graphs and sparse-pool coverage.
- **Acceptance:** every delivered pair feasible and authorized; no cap violation or
  one-sided match; state and audit verified after requests/jobs.
- **Dependencies/complexity/evidence:** M2 and synthetic reviewed-venue read contract;
  High. Not built. Artifacts: graph/property/race suite, benchmark and replay report,
  outbox failure tests and reviewed PR. No ML or Rust dependency.

## M4 — Conversations and jointly confirmed meetings

- **Stories/functional:** mutual members chat, select an approved public venue/time,
  both confirm the same revision, cancel freely and voluntarily share a plan/calendar.
- **Nonfunctional/architecture:** stable suggestions, accessibility/cost/operating
  hours and under 21 venue constraints; no private origin disclosed. Events are
  delivered only after fresh authorization.
- **DB:** conversations/messages, public venues/reviews/closures, immutable plan
  versions and confirmations, cancellation and notification outbox.
- **API proposal:** membership-gated message read/send; venue suggestions;
  idempotent plan propose/revise/confirm/cancel by version; minimized calendar export.
- **Security/tests:** I04/I09/I11/I19; mismatched confirmations, venue closure versus
  confirm, cancel/block versus confirm, repeated requests, stale notifications,
  expired venue reviews, no private origin in DTO/email/calendar.
- **Acceptance:** both confirm one still-valid plan, material edits invalidate prior
  confirmations, report/cancel reachable everywhere; real end-to-end mutual→plan.
- **Dependencies/complexity/evidence:** M3 and actual operator venue process; High.
  Not built. Required proof: transaction races, venue ranking/filter tests, API/E2E,
  accessible plan screens. Booking integrations remain separately approved scope.

## M5 — Optional feedback, outcome evidence and erasure

- **Stories/functional:** optionally report meeting/interest privately, invite again
  separately, exit with success, delete data and receive a receipt; operators inspect
  aggregates with explicit denominators and completeness.
- **Nonfunctional/architecture:** no feedback gates; no inference from silence;
  matching, logistics, integrity and safety kept separate. No learned serving model.
- **DB:** categorical feedback/provenance, consented follow-ups, minimized learning
  snapshots/lineage, deletion jobs/tombstones/store receipts and scoped safety holds.
- **API proposal:** own optional feedback/skip and separate reinvite; own deletion
  status/receipt; role-gated suppressed aggregate metrics; no other person's feedback.
- **Security/tests:** I10/I12/I18; no forbidden fields in exports/logs, fixture cohort
  denominators, missing/disputed outcomes, deletion retries and tombstones replayed
  after restore before serving, hold review and auth/media retention.
- **Acceptance:** deletion proven across primary/media/cache/exports/snapshots;
  restore drill passes; no feedback leakage/gating and reproducible metric definitions.
- **Dependencies/complexity/evidence:** M4 plus G09 consistency protocol; High.
  Not built. Completion requires deletion/restore evidence and privacy review;
  this is a live-enrollment gate, not optional analytics work.

## M6 — Controlled events and event-bound Go prototype

- **Stories/functional:** opt into an approved event, separately opt into dating,
  check in with rotating host code, offer a short meeting to an existing mutual
  connection, stop nearby and revoke authority without canceling a plan implicitly.
- **Nonfunctional/architecture:** all flags default off, no GPS, short leases,
  fail closed and bounded toggling. Organizers never see a dating opt-in roster.
- **DB:** event/operator approval, RSVP separate from dating consent, check-ins,
  scoped leases/epochs and nearby offers tied to existing reservation semantics.
- **API proposal:** separate RSVP/consent/check-in; versioned Go start/stop/accept
  using epoch+lease; minimal organizer attendance only.
- **Security/tests:** I04/I05/I06/I14/I17; stop/delivery/accept races, stale tokens,
  expired leases, worker restart, unauthorized organizer reads and reused capacity
  for existing mutuals. No network response may reveal a stranger's location.
- **Acceptance:** revocation measured against configured objective; base flow and
  deletion already work; staffing/kill-switch drill passed before any live activation.
- **Dependencies/complexity/evidence:** M5 plus applicable M7 operational gates;
  High. Not built. New-person Go and live experiment each require separate approval;
  evidence includes synthetic adversarial suite and later authorized field protocol.

## M7 — Final release hardening and operational readiness

- **Stories/functional:** members can rely on revocation/deletion/accessibility;
  operators can detect failure, stop features, handle incidents and restore safely.
- **Nonfunctional/architecture:** explicit SLOs, privacy-safe telemetry, credential
  separation/rotation, realistic cost/load model, documented on-call ownership.
- **DB/API:** index/query budgets, role review, retention/restore controls, exhaustive
  route×role×object×field matrix; no new engagement feature justified as hardening.
- **Security/tests:** all 20 invariants with real tests; slow bodies, multi-device
  revocation, colluding accounts, cache/email timing and inference probes; worker
  crashes/timeouts; secret/dependency scans; manual screen reader/mobile/zoom;
  restore, incident and kill-switch rehearsals.
- **Acceptance:** PDF P23 gates documented, residual risks owned, D1–D15 data flows
  reviewed, real venues/providers/support ready, explicit release approval.
- **Dependencies/complexity/evidence:** work starts throughout M1–M6; final live
  scope determines full matrix; High. Not complete. Requires RUNBOOK, PRIVACY_REVIEW,
  measured load/accessibility/security reports and explicit human decisions.

## Next execution sequence and five priorities

1. Finish the M1 merge review on PR #3; PR #4's email repair is already merged into
   M1. PR #3 is not authorized to merge yet. PR #1 is an older superseded M0 proposal;
   leave it open as the founder requested. No M2 work starts during this review.
2. Implement M2's smallest vertical slice: independent bilateral block plus a
   private report, reviewer authorization and audit, with functional UI on existing
   surfaces. Extend to appeals/kill switches before calling M2 complete.
3. Establish M3's pair/hold transaction protocol and adversarial test harness before
   ranking UI; retain simple heuristic and truthfully sparse supply.
4. Build M4's mutually confirmed plan and M5 erasure/restore in the pre-pilot path;
   resolve G03/G09 authority and storage hazards before any real accounts.
5. Validate local feasibility and operations using the approved research protocol;
   measure wanted meetings and effort. Keep Go, serving ML and Rust conditional.

For every slice: pure policy tests → real-role PostgreSQL integration/races → API
ownership matrix → affected browser/axe flow → full quality command → remote CI
on exact head → review and explicit merge decision. A network response alone is
never acceptance evidence; inspect resulting durable state and unauthorized reads.
