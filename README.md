# Meetwell — Human Connection Platform

M0 engineering foundation for a Manhattan, NYC pilot, ages18–30. Meetwell is a working name. **This branch is a scaffold, not a live dating service.** All test data is synthetic. No member, safety, matching, chat or event feature is implemented yet.

Start with [AGENTS.md](AGENTS.md), then read [architecture v0.2](docs/architecture-v0.2.txt). [CODEX_PROMPTS.md](CODEX_PROMPTS.md) defines M0–M7. Run one milestone at a time and review/merge its PR before the next.

- [Requirement trace](docs/SPEC_TRACE.md):193 testable product requirements, planned tests and all20 invariants.
- [Architecture](docs/ARCHITECTURE.md): boundaries, entity/key/index model, state diagrams, API authorization, queues, locking and D1–D15 retention.
- [Decisions](docs/DECISIONS.md): protective interpretations and founder questions.
- [Backlog](docs/BACKLOG.md): milestone dependency/gate plan.
- [M0 report](docs/M0_REPORT.md): actual verification outcomes and highest risks.

## Prerequisites

Node24 LTS, pnpm12.11.2, and either Docker Compose v2 or Ubuntu24.04 with normal sudo/service-user support. Install pnpm with `npm install --global pnpm@12.11.2` or the matching Corepack version. Exact direct versions and the transitive lockfile are committed. Do not substitute SQLite or a memory database.

## Local setup with Docker

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm services:up
pnpm db:migrate
pnpm db:grant-local-worker
pnpm build
pnpm test:unit
pnpm test:integration
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

`services:up` starts PostgreSQL16/PostGIS, MinIO and Mailpit, binding ports to loopback. MinIO builds from the pinned official source release because the old binary endpoint is gone; the first build may take several minutes. Compose creates separate `meetwell_dev` and `meetwell_test` databases. The integration runner refuses a database URL whose name does not end in `_test`; it creates only synthetic test objects and never wipes an arbitrary database.

The migration administrator is local development only. `db:grant-local-worker` grants the pre-created non-superuser development login access to the queue group. Production must provision separate service credentials and purpose-scoped grants. No development password should be used outside this loopback setup.

Run `pnpm dev` for the Next.js scaffold at http://127.0.0.1:3000. Run `pnpm worker` in another terminal for the real pg-boss infrastructure worker. There are no product job handlers yet. Mailpit UI is http://127.0.0.1:8025; MinIO console is http://127.0.0.1:9001. Storage/media integration and outgoing product mail arrive later.

## Native fallback when Docker is unavailable

```sh
bash scripts/setup-native.sh
cp .env.example .env
bash scripts/start-local-services.sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:grant-local-worker
```

The fallback uses apt to install PostgreSQL16 and PostGIS, starts a real database service as `postgres`, creates development/test databases idempotently, compiles pinned MinIO source using Go, and verifies the pinned Mailpit archive checksum. It requires network access and sudo capable of switching to the database service account. It never changes your HOME or replaces the required database. Other OS versions should use Compose. Stop the auxiliary services with `bash scripts/stop-local-services.sh`; stop PostgreSQL with the normal service tooling when desired.

A sandbox mapping only UID0 cannot run a normal PostgreSQL service; setup must report this limitation rather than fake a database result. Use the real PostGIS service in CI or a supported development machine.

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

Unit tests cover every workspace, including a pure property test. Integration tests prove PostgreSQL16/PostGIS presence, migration replay, runtime schema denial and actual durable pg-boss execution. End-to-end tests cover the M0 page and its versioned liveness endpoint only. Product invariants remain planned at their assigned milestone; a passing scaffold is not a safety certification.

GitHub CI runs the same gates against an isolated real PostGIS service. Development/CI database credentials are intentionally synthetic. Do not upload real member data, credentials, message content, report narratives or location samples into this public repository or its artifacts.

## Migration and service controls

`pnpm db:migrate` uses an advisory lock, per-file transactions and immutable SHA256 checksums. Never edit an applied migration; add a forward migration. The first migration creates five application schemas/roles plus an isolated pg-boss queue schema and an ops migration ledger. Runtime roles do not own application schemas or receive broad table grants. Rollback of the initial boundary migration requires a disposable database or an explicit destructive teardown; automatic down migration would risk deleting private data.

`packages/config/src/pilot.ts` centralizes pilot caps, timers, retention maxima, Manhattan area references and feature flags. EVENTS_ENABLED, GO_ENABLED and NEW_PERSON_GO_ENABLED default to false. No production deployment is performed by M0 CI; it only verifies source. Keep the prior preview separate from this architecture.
