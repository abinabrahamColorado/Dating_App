# Project status

Updated 2026-10-20. Working name: **Meetwell**.
Launch scope: Manhattan, New York City; ages 18–30.

## Current milestone

**M0: foundation prepared for review. Product features have not started.**

The permanent local checkout is `E:\Buisness\Dating_App`.
The remote is `https://github.com/abinabrahamColorado/Dating_App`.
The working branch is `codex/m0-local-foundation`.
GitHub access was enabled for this repository during this setup.

Recovered the unpublished M0 source from the earlier **Platform Architecture Report**
chat's Git tree payload and subsequent patches. Preserved the repository's
`AGENTS.md`, source architecture text, and PDF. Revalidated the code locally and
added Windows tooling, workflow documentation, and infrastructure fixes.

## What exists

- Next.js web scaffold and versioned liveness endpoint.
- Separate worker, pure domain, database, and configuration workspaces.
- Real PostgreSQL 16/PostGIS schema boundaries, roles, and immutable migration ledger.
- A pg-boss health job that executes using a restricted worker role.
- Project-local Windows PostgreSQL/PostGIS, MinIO, and Mailpit with health checks.
- Compose and native Linux setup, with CI definitions.
- Architecture, 193 planned requirements, all 20 invariant mappings, pilot settings,
  decisions, and the M1–M7 roadmap.
- Branch/review instructions, pull request template, and an editor workspace.

## Verified locally

| Check                                     | Result                                                                |
| ----------------------------------------- | --------------------------------------------------------------------- |
| Locked dependency installation            | Passed                                                                |
| Typecheck, lint, formatting               | Passed in the final sequential local quality run                      |
| Production web build                      | Passed                                                                |
| Unit tests                                | 9 passed                                                              |
| Real PostgreSQL/PostGIS integration tests | 6 passed                                                              |
| Chromium browser test                     | 1 passed                                                              |
| Native services                           | PostgreSQL, MinIO and Mailpit health checks passed                    |
| Stop/restart and migration replay         | Checked during local setup                                            |
| GitHub CI                                 | Runs on branch and pull request; inspect GitHub checks before merging |

The integration suite exercises concurrent migration replay, checksum drift,
schema isolation across unrelated runtime roles, and actual durable job completion
without granting the worker database CREATE privilege. Product invariant suites
remain planned for the milestones that implement those features.

## Next step

Review the M0 pull request, CI results, and decisions, then merge before M1.
M1 adds the public pages, email sign-in, adult eligibility, onboarding, preferences,
photo moderation, account states, and operator access foundation.
Use the M1 section of `CODEX_PROMPTS.md` with this repository as context.

Resolve relevant product questions in `docs/DECISIONS.md` as implementation reaches
them: final name/areas, age-out policy, supported intentions, operational ownership,
and production providers. Live enrollment remains gated by completed safety,
deletion, security, and operational readiness work.

## Start working

Follow `docs/DEVELOPMENT_WINDOWS.md`. Start with:

```powershell
Set-Location E:\Buisness\Dating_App
corepack pnpm services:windows:start
corepack pnpm dev
```

Use `corepack pnpm services:windows:stop` when finished. Local service data and
configuration live in ignored `.local/` and `.env`; source and documentation belong in Git.
