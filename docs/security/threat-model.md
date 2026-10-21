# Threat model — current boundary and release expansion

Updated 2026-10-20; supplements authoritative PDF P20–P22, not a replacement.
Scope now: synthetic loopback M1, private media and local mail. Real enrollment is
disabled. Safety case processing, matching and nearby discovery are not implemented.

| Threat actor/action                | Protected boundary              | Current control                                                                       | Open release requirement                                                              |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Anonymous credential abuse         | Identity/session                | Generic responses, keyed budgets, expiring browser-bound token, user-verified passkey | Per-client/global fairness, total body deadlines, recovery and abuse review           |
| Member guesses another object      | Profiles/media/account state    | Random IDs plus server owner/role/field checks, no-store private bytes                | Complete route/field matrix as features arrive; stale authority races                 |
| Staff abuses access                | Moderation/private data         | Role gate, no self-approval, append-only audit, narrow DB grants                      | Assigned safety cases, credential/process separation, atomic staff revocation         |
| Concurrent commands bypass consent | Policy/capacity/plans           | M1 locks/CAS/receipts; later components absent                                        | Pair lock order, durable enforcement, last-slot and plan-version tests                |
| Stale nearby session or collusion  | Location privacy                | No member GPS or live nearby processing                                               | Epoch/lease revocation and disclosure/timing probes before Go                         |
| Malicious upload                   | Media decode/storage            | Byte/pixel/format limits, metadata stripping, encryption/private bucket               | Decode resource budgets, ambiguous-commit reconciliation, scoped S3 credentials       |
| Worker crash/duplicate delivery    | Durable state and notifications | Auth row locks/retries and single-use link; focused COMMIT-fault test                 | Full process crash/timeout and product notification authorization tests               |
| Compromised process/backup         | Sensitive datasets              | Separate schemas/keys and local-only access                                           | KMS rotation, least-privilege processes, monitored backup custody, restore tombstones |
| Poisoned dependencies/tool output  | Build and local PC              | Lockfile/release age; no REA install                                                  | CI secret/dependency policy, pinned actions, isolated authorized tooling              |

Case narratives and reporter identity must never reach ordinary member responses,
learning rows or telemetry. Attendance/rejection is not a safety classification.
Report, block, appeal and deletion have distinct purposes and access requirements.
An event ticket or photo badge is not a guarantee that a person is safe.

Release review must enumerate actual D1–D15 fields, processors and retention,
including keys, exports, caches, logs, backups and scoped legal holds. Own the
residual risks in the architecture review (G02–G15); no silent waiver through an
environment-variable change. Founder decisions on staffing, venues, vendors and
privacy review are prerequisites for real use, not prerequisites for local M2 work.
