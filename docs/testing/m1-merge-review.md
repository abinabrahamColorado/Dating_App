# M1 merge review for PR #3

Review date: 2026-10-20 America/Chicago (21 October UTC). Starting M1 head:
`ade0c78259e4c27ac6d288d8d95e94ea7079f292`; main: `16676f3`.
Scope: founder decisions, Markdown repair, regression evidence, migration safety,
content/scope review and full verification. No M2 work, deployment or merge.

## Founder decisions

DEC-033 explicitly rejects the DEC-031 crosswalk. CODEX_PROMPTS.md numbering and
order remain authoritative. M5 includes deletion; M6 is events/Go; M7 hardening.
Deletion and operational readiness before any real users or Go are approved.
Ambiguous-send duplicate magic-link emails are accepted as a documented limitation.
REA remains uninstalled; competitor research is complete for now.

DEC-034 prohibits blanket regex rewrites over documents. The
[complete rewrite inventory](markdown-rewrite-audit.md) compares original creation
text against commit `90b371f`: 44 changed content lines across six files, two
unchanged files. Explicit corrections restore the Mailpit URL, Timeleft +1 and
five lines of invariant-reference spelling. No numeric value, clock time, version
value or quotation corruption was found. The source PDF/text and original prompts
remain unchanged.

## Original-bug regression proof

Used a newly created disposable PostgreSQL/PostGIS test database, not existing
development records. Checked out only `packages/db/src/accounts.ts` from `3cc38d7`
with `git restore --source=3cc38d7 --worktree -- packages/db/src/accounts.ts`.
The test harness, configuration and additive schema remain current so the tests
exercise the old behavior rather than failing on missing infrastructure.
Git blob identity before execution:

- Original: `93c21abf799ec84735ac697586ec5613aa9f3002`.
- Restored fixed implementation: `74d0e5546ee08410c831a4660b27af577436d38e`.

Command, run twice against the same isolated database:

```powershell
corepack pnpm exec vitest run --config vitest.integration.config.ts tests/integration/auth-delivery.test.ts --reporter=verbose
```

| Test                                                   | Original implementation                                                        | Restored implementation |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------- |
| Isolates corrupt/failed messages and delays retries    | Fails: corrupt row throws `Invalid encrypted value`                            | Pass                    |
| Skips expired, consumed, future and exhausted messages | Fails: sends two ineligible rows                                               | Pass                    |
| Concurrent runners skip a locked send                  | Fails: first runner locks the whole batch; second cannot deliver the other row | Pass                    |
| Commit failure preserves earlier sends                 | Fails: earlier `sent_at` is null after rollback                                | Pass                    |

```text
Original: exit 1; Test Files 1 failed (1); Tests 4 failed (4)
Restored: exit 0; Test Files 1 passed (1); Tests 4 passed (4)
```

The original failure is an uncaught decryption error plus three assertion failures,
not an import/compiler/database-startup failure. Restoration was protected by a
finally block and its blob hash was verified. The disposable database was removed.
No test expectation or production code was changed to obtain this result. This is
a regression proof; it is not a whole-worker process-kill or real-provider test.

## Migration 0004

The SQL remains unchanged: one `ADD COLUMN next_attempt_at timestamptz NOT NULL
DEFAULT now()` plus one partial index on due time, creation time and ID for unsent,
unconsumed rows. No DROP, DELETE, payload update, privilege grant or external send.

Created a separate disposable database, applied original migrations 0001–0003 and
their checksum records, then seeded synthetic identity/member/profile and four
outbox rows covering pending, sent, consumed and exhausted states. Verified:

- Applying 0004 in a transaction then rolling back preserves baseline data and
  removes the new index; normal migration application succeeds afterward.
- All original values across 15 application-table snapshots and all table ACLs
  remain unchanged. The new column is non-null, correctly typed and defaults to now.
- Existing rows receive a due time; the partial index is valid and ready.
- The identity role can still insert using the old column list and update due time;
  the app role remains denied access to identity magic links.
- The table's physical file identity is unchanged in this fixture. This is evidence
  of no heap rewrite here, not a large-table performance benchmark.
- Re-running the actual migration runner preserves data and retains one checksum
  entry for 0004. Direct re-execution of raw ALTER SQL is not claimed idempotent.

**Assessment:** additive and compatible with the M1 schema. ALTER TABLE takes a
strong table lock and the ordinary index build can block writes. Suitable for
the current synthetic environment; this is not a zero-downtime production claim.
Future production application needs a reviewed lock/size/window plan. Apply schema
before the new sender; keep the additive schema on code rollback. No production
migration or existing-data reset was performed.

## PR content and scope

Reviewed the complete diff from main and scanned current changed files plus all
85 blob versions introduced by the existing M1/audit commits. The scan compares
against actual generated local encryption/lookup keys and database passwords
without printing them, and checks private-key and common provider-token patterns.
The same scan is repeated after the final review files are staged/committed.

No generated credentials, private keys or provider tokens were found. Literal
emails use only `synthetic.invalid`, `meetwell.invalid` or reserved `invalid.test`.
The last is an explicit synthetic API test. Birth dates and profile fields are
declared test inputs; browser photos are generated color images, not people.
No member dataset, uploaded photo, database dump, runtime log or binary data file
is added by PR #3. `.env`, `.local`, dependencies and browser artifacts remain
ignored. Public repository/author references are provenance, not member records.
These are source/history scans and fixture review, not a proof that pattern
scanning can recognize every possible secret or personal detail.

All changed paths map to authorized scope:

- M1 public/member/operator UI, account/domain/API/media/auth code and tests.
- M1 packages/lockfile, local setup, worker auth delivery and development CI.
- Requested competitor/REA research, architecture/roadmap/security/test/runbook
  documentation, and this founder-directed repair/review evidence.

No unrelated application, M2 implementation, Rust, third-party REA code, real
provider integration or deployment configuration was introduced. Existing G02,
G03, G08 and G09 findings remain documented live-release risks, not silently fixed
or reclassified as production-ready by this review.

## Verification and merge disposition

Full local `corepack pnpm check` completed successfully after the corrections:

```text
Typecheck, lint, formatting: PASS
Unit/property:              16 passed (7 files)
PostgreSQL integration:     18 passed (3 files)
Production build:           PASS
Chromium browser:            7 passed (19.7 seconds)
Total:                      41 passed
```

The source code, tests, migrations, lockfile and source specification are unchanged
by this review commit. Final evidence-summary formatting was rechecked afterward.
Known Node WebCrypto/color-environment warnings did not fail any checks. Local
services were stopped with existing data preserved after each verification.
The exact final PR head and CI run are recorded in the PR description and task
handoff, which can be updated without triggering another source commit.

The old M0 PR #1 remains open. Its foundation proposal is superseded by merged
PR #2 and must not be merged over the accepted foundation; it was not closed.

The target decision is whether to merge the synthetic, loopback-only M1 milestone
into main. Real enrollment/Go remain prohibited until approved deletion, safety
and operational gates pass. Passing review is not merge authorization; the founder
explicitly instructed that PR #3 remain unmerged and M2 not start during this task.
