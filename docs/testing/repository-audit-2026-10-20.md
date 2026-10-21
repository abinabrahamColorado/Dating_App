# Repository reality check — 20 October 2026

Permanent root: `E:\Buisness\Dating_App`.
Remote: `https://github.com/abinabrahamColorado/Dating_App.git`.
The chat scratch directory is not another product repository.

## Initial Git and GitHub snapshot

- Working tree was clean on `codex/m1-accounts-onboarding`, local and origin head
  `3cc38d7663ab63db6db3f2b3d80fe181cbac74b2`.
- Remote main was `16676f3b34020c0b626964f4063bb33f9cbd5cf1`, the M0 PR #2 merge.
  Local main was two commits behind; no reset/overwrite was used to “fix” that.
- Authenticated open-PR inspection found PR #3 (M1) and PR #1 (older M0).
  PR #3 had no submitted reviews. Its current checked
  [run39384006645](https://github.com/abinabrahamColorado/Dating_App/actions/runs/39384006645)
  had successful `windows`, `dev-services`, `verify` jobs.
- PR #1 head `b1089543` is an older competing foundation, reported non-mergeable.
  Its two historical checks passed
  [run39378390405](https://github.com/abinabrahamColorado/Dating_App/actions/runs/39378390405).
  Those checks do not validate the current M1 branch. PR #1 was not closed or merged.
- New branch: `codex/m1-audit-auth-delivery`, based on exact M1 head. Nothing was
  merged, force-pushed, deployed or deleted. See PROJECT_STATUS for publication.

## Inspection and implementation inventory

Read AGENTS, CODEX_PROMPTS, README, workspace/manifests, CI, architecture/decision/
backlog/trace documents and applicable source/tests/scripts. Examined M0/M1 change
inventory and M1 policy, database, API, media, authentication, worker and browser
contracts. M1 changes 58 files, with 6302 insertions/124 deletions from main.
This is an engineering source review, not an independent penetration test or
line-by-line certification of every transitive dependency/generated file.

The authoritative PDF and extracted text were read in this continuing project;
the hash still matches the original 67-page PDF. P3/P23/P31/P32 were revisited for
competitive research, scope and gates. No PDF rewrite or redundant source copy.

| Area                | Actual state                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0                  | Workspaces, role boundaries, migrations, config, CI, real local services and durable infrastructure job implemented; PR #2 merged                                                     |
| M1                  | Functional public pages, email/passkey auth, DOB/consent, profiles, versioned three-way preferences, private photo moderation, account/session controls and ops audit; PR #3 unmerged |
| Partial             | Bilateral preferences are a pure gate, not the full allocator; RESTRICTED state is not a safety case system; DELETE disables access but does not erase data                           |
| Missing             | Blocks/reports/appeals, reservations, introduction decisions, chat, joint plans, feedback datasets, retention/restore orchestration, events and Go                                    |
| Test boundaries     | Synthetic fixtures; media repository tests isolate object I/O with callbacks, while browser tests use real MinIO/Mailpit. No product feature is an empty handler                      |
| Deliberately absent | Serving ML, Rust app code, precise member GPS, real vendors/payments, production enrollment                                                                                           |

`rg` did not find product TODO/FIXME placeholders. That is not proof of completeness;
the missing milestones above remain missing even without TODO markers.

## Dependency and runtime observations

Observed local Node 24.19.0; engines 24; pnpm 12.11.2. Manifest pins include Next 16.4.1,
React 19.3.1, TypeScript 6.0.3, pg 8.23.1, Drizzle 0.45.4, pg-boss 12.38.0,
Vitest 5.0.4, Playwright 1.64.1, fast-check 4.10.2, Zod 4.6.7,
SimpleWebAuthn server 14.0.3/browser 14.0.0, sharp 0.35.5, nodemailer 10.1.7
and S3 SDK 3.1152.0. Exact transitive graph remains the lockfile's responsibility.
`corepack pnpm audit --audit-level high` exited0: **No known vulnerabilities found**
at query time. No dependency was added for this audit; no REA code was executed.
CI action references are major tags, not immutable SHAs; G15 tracks improvement.

## Commands actually run

1. Fresh baseline `corepack pnpm check`: typecheck, lint, formatting, 16 unit/property,
   14 PostgreSQL integration, production build and 7 Chromium tests passed (37 total).
2. After the repair, `corepack pnpm setup:accounts` applied additive 0004 to local
   dev/test only, then `corepack pnpm test:integration` passed 18 tests, including
   four new fault/concurrency cases.
3. Final full verification and exact remote CI are recorded in PROJECT_STATUS.

Services were stopped with data preserved after each local verification. Browser
tests emit known Node experimental WebCrypto and color-environment warnings; no
test failed because of them. These warnings are not claimed to be fixed.

## Immediate slice and review outcome

The auth sender could repeat already-sent mail and delay later links when one row
failed because delivery markers shared one transaction. This branch commits each
message independently, persists retry budgets/due time and keeps error logs free
of payloads. A real deferred-COMMIT failure test demonstrates the remaining SMTP
ambiguity instead of claiming impossible exactly-once email. No public API/UI
change, new dependency or production migration.

M1 remains suitable for synthetic local evaluation. It is not ready for real
members: architecture findings G02/G03/G08/G09 and full safety/deletion/operations
gates remain. M2 starts after reviewed M1 work and explicit merge authorization.
No unrelated milestone implementation was mixed into this correction.
