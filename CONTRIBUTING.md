# Engineering workflow

Read `AGENTS.md` and `docs/architecture-v0.2.txt` before implementation.
Use `docs/PROJECT_STATUS.md` to resume work and `docs/BACKLOG.md` for milestone scope.

## Branches and reviews

Keep `main` as the reviewed baseline. Work on a `codex/<milestone>-<change>` branch,
make a focused commit, and open a pull request that explains behavior and validation.
Do not force-push or mix unrelated milestones. Review one milestone and obtain
explicit founder authorization to merge before starting the next. Merges, branch
deletion, deployment and irreversible production migrations are approval-only
(DEC-029). A green check is not merge authorization or a completed product.
Stack a focused correction on an unmerged milestone when necessary; name its base
and dependency in the PR. Never overwrite another branch to fold in the correction.

Run `corepack pnpm check` sequentially: Next.js build and route generation share
generated files and must not run concurrently in the same checkout.
Database tests require a dedicated real PostgreSQL 16/PostGIS database with a name
ending in `_test`. Use synthetic records only.

## Where work belongs

- `apps/web`: UI and HTTP adapters; object/field authorization at every API boundary.
- `apps/worker`: durable job dispatch and delivery, with policy rechecks.
- `packages/core`: pure domain rules and state machines.
- `packages/db`: migrations, transactions, locks, and repositories.
- `packages/config`: pilot numbers, launch scope, and flags.
- `tests`: unit/property, database integration, and browser coverage.
- `docs`: specification trace, decisions, architecture, status, and operating notes.
- `.local`: ignored developer tools, data, cache, and logs.

Update the trace, decisions, backlog, and status with each milestone.
Never edit an applied SQL migration. Repository text uses LF to keep checksums
consistent on Windows and Linux.

## Data and dependencies

Keep secrets in ignored local environment files or the deployment secret store.
Commit only examples with synthetic development values. This repository is currently
public; never commit member information, reports, database dumps, or private keys.
Review direct dependency changes and lockfile diffs. Only explicitly approved package
install scripts run. External integrations require their own scoped milestone.

## Completion evidence

State what works, what was tested, what remains unverified, and the next milestone.
CI, security, privacy, and accessibility findings remain blocking where applicable.
Live enrollment requires the release and operations gates in Spec P23, not simply
successful deployment.
