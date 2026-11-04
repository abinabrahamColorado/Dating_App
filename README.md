# Meetwell — Human Connection Platform

M3 Explore engine for a Manhattan, NYC pilot, ages 18–30. Meetwell is a working name. **This is a loopback-only development build using synthetic data.** Accounts, safety review, bilateral eligibility, finite introductions, private decisions and connection closure work. Chat and plans belong to M4; complete erasure belongs to M5. M2 is merged with founder approval; the M3 PR must remain unmerged for review.

Start with [AGENTS.md](AGENTS.md), then read the authoritative [architecture PDF](docs/architecture-v0.2.pdf) and its [extracted text](docs/architecture-v0.2.txt). [CODEX_PROMPTS.md](CODEX_PROMPTS.md) defines M0–M7. Run one milestone at a time and review/merge its PR before the next.

Merges require explicit founder approval (DEC-029). Resume from
[project status](docs/PROJECT_STATUS.md), the [roadmap](docs/product/roadmap.md)
and [repository audit](docs/testing/repository-audit-2026-10-20.md).
The latest [competitive research](docs/research/competitive-landscape-2026.md),
[REA evaluation](docs/research/rea-evaluation.md) and
[architecture review](docs/architecture/review-2026-10-20.md) distinguish verified
implementation, published claims and proposals. The PDF remains authoritative.

- [Current status and next step](docs/PROJECT_STATUS.md).
- [Windows development](docs/DEVELOPMENT_WINDOWS.md): setup and daily start/stop commands.
- [Engineering workflow](CONTRIBUTING.md): branches, reviews, verification, and source ownership.
- [Requirement trace](docs/SPEC_TRACE.md): 193 testable product requirements, planned tests and all 20 invariants.
- [Architecture](docs/ARCHITECTURE.md): boundaries, entity/key/index model, state diagrams, API authorization, queues, locking and D1–D15 retention.
- [Decisions](docs/DECISIONS.md): protective interpretations and founder questions.
- [Backlog](docs/BACKLOG.md): milestone dependency/gate plan.
- [M0 report](docs/M0_REPORT.md): actual verification outcomes and highest risks.

## Prerequisites

Node 24 LTS, Git, and pnpm 12.11.2 through Corepack. Use the native Windows setup, Docker Compose v2, or Ubuntu 24.04 with normal sudo/service-user support. `corepack pnpm` selects the repository's pinned package manager. Exact direct versions and the transitive lockfile are committed. Do not substitute SQLite or a memory database.

## Start here on this Windows PC

The working folder is `E:\Buisness\Dating_App`. Open `Dating_App.code-workspace`
or open this folder directly in your editor.

```powershell
Set-Location E:\Buisness\Dating_App
corepack pnpm install --frozen-lockfile
corepack pnpm setup:windows
corepack pnpm db:migrate
corepack pnpm db:grant-local-worker
corepack pnpm setup:accounts
corepack pnpm dev
```

After the first setup, use `corepack pnpm services:windows:start` and
`corepack pnpm dev`. Run `corepack pnpm worker` in a second terminal at the root.
Stop the background services with `corepack pnpm services:windows:stop`.

For M2, rerun `corepack pnpm setup:accounts` to apply additive migrations and generate
the separate safety login/key in ignored `.env`. Open `/safety/concern`,
`/safety/help` or `/safety/cases`. `/ops/safety` requires a separately assigned
`safety_reviewer` role; admin alone is insufficient. Local synthetic staff access:
`corepack pnpm staff:grant <member-id-or-synthetic-email> safety_reviewer`;
revoke with `corepack pnpm staff:revoke <member-id-or-synthetic-email> safety_reviewer`.
See [M2 safety operations](docs/operations/safety.md) for boundaries and review steps.
The [Windows guide](docs/DEVELOPMENT_WINDOWS.md) documents ports, data, and diagnostics.

For M3, rerun `corepack pnpm setup:accounts`. Use `corepack pnpm seed:explore-venue`
only for a clearly synthetic development feasibility fixture. Open `/ops/explore`
with an operator account to prepare, review and approve a batch; the running worker
delivers eligible introductions to `/explore`. `corepack pnpm benchmark:explore`
compares the allocator with an exact solver on small synthetic graphs.
See [Explore operations](docs/operations/explore.md) for review, expiry, concurrency
and uncertain-mail handling. No real venue is approved by the fixture command.

## Repository map

```text
apps/web/           Next.js UI and /api/v1 HTTP adapters
apps/worker/        Durable background processing
packages/core/     Pure domain rules
packages/db/       PostgreSQL schema, migrations, repositories
packages/config/   Launch settings, pilot numbers, feature flags
packages/runtime/  Shared server/worker account construction and mail adapters
tests/             Unit/property, integration, and browser tests
docs/              Specification, architecture, decisions, trace, roadmap
scripts/           Reproducible setup and development commands
.github/           CI and pull request template
.local/            Ignored tools, caches, synthetic data, and logs
```

## Local setup with Docker

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm services:up
pnpm db:migrate
pnpm db:grant-local-worker
pnpm setup:accounts
pnpm build
pnpm test:unit
pnpm test:integration
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

`services:up` starts PostgreSQL16/PostGIS, MinIO and Mailpit, binding ports to loopback. MinIO builds from the pinned official source release because the old binary endpoint is gone; the first build may take several minutes. Compose creates separate `meetwell_dev` and `meetwell_test` databases. The integration runner refuses a database URL whose name does not end in `_test`; it creates only synthetic test objects and never wipes an arbitrary database.

The migration administrator is local development only. `db:grant-local-worker` grants the pre-created non-superuser development login access to the queue group. Production must provision separate service credentials and purpose-scoped grants. No development password should be used outside this loopback setup.

Run `pnpm dev` and open http://localhost:3000 (use localhost for passkeys). Run `pnpm worker` in another terminal for pg-boss and durable email retries. Mailpit is http://127.0.0.1:8025; MinIO console is http://127.0.0.1:9001. Sign in with a synthetic address and open the Mailpit link in the same browser. Photos are encrypted in private buckets; the member account controls and moderation queue are usable locally.

## Native Linux fallback when Docker is unavailable

```sh
bash scripts/setup-native.sh
cp .env.example .env
bash scripts/start-local-services.sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:grant-local-worker
pnpm setup:accounts
```

The Linux fallback uses apt to install PostgreSQL 16 and PostGIS, starts a real database service as `postgres`, creates development/test databases idempotently, compiles pinned MinIO source using Go, and verifies the pinned Mailpit archive checksum. It requires network access and sudo capable of switching to the database service account. Stop the auxiliary services with `bash scripts/stop-local-services.sh`; stop PostgreSQL with the normal service tooling when desired. Windows has the separate native workflow above.

The earlier cloud environment could not run PostgreSQL. Current local and CI verification evidence is recorded separately in `docs/PROJECT_STATUS.md`; earlier environment limitations are historical.

## Verification and CI

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

Unit tests cover every workspace, including a pure property test. Integration tests prove PostgreSQL16/PostGIS presence, migration replay, runtime schema denial and actual durable pg-boss execution. End-to-end tests cover public/member/operator pages, accessibility, real email onboarding, object/field authorization, moderated activation, passkeys and re-authentication. SPEC_TRACE.md identifies the implemented M1 portions; later invariants remain planned.

Run `corepack pnpm check` for the complete sequence. Do not run Next build and
type generation concurrently in the same checkout; both write generated files.
Database services must be started before integration tests.

GitHub CI runs the same gates against an isolated real PostGIS service. Development/CI database credentials are intentionally synthetic. Do not upload real member data, credentials, message content, report narratives or location samples into this public repository or its artifacts.

## Migration and service controls

`pnpm db:migrate` uses an advisory lock, per-file transactions and immutable SHA256 checksums. Never edit an applied migration; add a forward migration. The first migration creates five application schemas/roles plus an isolated pg-boss queue schema and an ops migration ledger. Runtime roles do not own application schemas or receive broad table grants. Rollback of the initial boundary migration requires a disposable database or an explicit destructive teardown; automatic down migration would risk deleting private data.

`packages/config/src/pilot.ts` centralizes pilot caps, timers, retention maxima, Manhattan area references and feature flags. EVENTS_ENABLED, GO_ENABLED and NEW_PERSON_GO_ENABLED default to false. CI verifies source; it does not deploy production. Keep the prior preview separate from this architecture.
