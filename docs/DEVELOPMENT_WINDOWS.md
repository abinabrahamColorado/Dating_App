# Windows development

The permanent checkout for this machine is `E:\Buisness\Dating_App`.
Open `Dating_App.code-workspace` in VS Code, or open this folder in your editor.
The scripts also work when the repository is cloned elsewhere.

## First setup

Install Node 24, Git for Windows, and Corepack. From the repository root:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm setup:windows
corepack pnpm db:migrate
corepack pnpm db:grant-local-worker
corepack pnpm setup:accounts
corepack pnpm check
```

Install the browser once before the first full check:

```powershell
corepack pnpm exec playwright install chromium
```

The setup downloads pinned PostgreSQL 16.15, PostGIS 3.6.2, Go 1.27.3, and
Mailpit 1.31.6. It builds MinIO from the same pinned official commit as Compose.
The first run downloads several hundred megabytes and compiles the storage service.
It requires network access and disk space, but no Windows service installation,
administrator access, Docker, or WSL.

Everything specific to these services lives in ignored `.local/`:

- `tools/`, `bin/`, `src/`: binaries and MinIO source.
- `cache/`, `go-cache/`, `go-path/`: download and compilation caches.
- `data/postgres/`, `data/minio/`: local development data.
- `logs/`, `run/`: diagnostics and process identifiers.

The setup creates `.env` only if absent and uses PostgreSQL port **55432**.
An existing `.env` is preserved; if switching from Compose, intentionally update
its database ports from 5432 to 55432. It creates separate `meetwell_dev` and
`meetwell_test` databases and a non-superuser worker login. Do not use these
published synthetic credentials outside this local development setup.

## Daily use

```powershell
corepack pnpm services:windows:start
corepack pnpm dev
# In a second terminal at the repository root:
corepack pnpm worker
```

| Service             | Local address                             |
| ------------------- | ----------------------------------------- |
| Member web app      | `http://localhost:3000`                   |
| Mailpit inbox       | `http://127.0.0.1:8025`                   |
| MinIO console       | `http://127.0.0.1:9001`                   |
| PostgreSQL          | `127.0.0.1:55432`                         |
| Test browser server | `localhost:3100` (test runner manages it) |

Stop the foreground web/worker with Ctrl+C. Manage the background services with:

```powershell
corepack pnpm services:windows:status
corepack pnpm services:windows:stop
```

Stopping preserves databases and object storage. Startup checks service ownership
and occupied ports; it does not terminate unrelated applications.
The services bind only to loopback. Setup and start do not change firewall rules.

## Reproducibility and provenance

`scripts/windows-artifacts.json` pins HTTPS URLs and SHA-256 digests.
Go and Mailpit hashes were compared with publisher-provided release metadata.
The PostgreSQL and PostGIS hashes record the archives downloaded from their official
distribution endpoints on 2026-10-20; they are reproducibility pins, not independently
signed provenance. A changed hash stops setup. Update pins deliberately after review.
MinIO is checked out at commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`.
Build dependencies use Go's module checksum verification.

Official distribution documentation:
[PostgreSQL Windows](https://www.postgresql.org/download/windows/),
[EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries),
[PostGIS Windows](https://postgis.net/documentation/getting_started/install_windows/released_versions/).

## Troubleshooting

Check `.local/logs/` when a service fails health checks. Resolve a port conflict
before restarting; never point test commands at a live member database.
Keep `corepack pnpm check` sequential because the Next build and type generation
share generated files. The repository enforces LF line endings for migration hashes.
Do not copy `.local`, `.env`, or `node_modules` to GitHub.

## Accounts and a synthetic photo reviewer

Run `corepack pnpm setup:accounts` with services running after pulling M1.
It migrates dev/test, provisions separate identity/app/ops logins, generates
encryption keys, and creates private buckets. Keys/passwords remain in ignored
`.env`; never replace them casually or encrypted local data becomes unreadable.
For local development only, storage uses the loopback MinIO administrator.

Open `http://localhost:3000`, sign in with a synthetic address, retrieve the email
from Mailpit and open its link in the same browser. Use a synthetic adult date and
synthetic images. Create a second registered account for photo moderation, then:

```powershell
corepack pnpm staff:grant reviewer@synthetic.invalid operator
# Optional audit-review access for this synthetic staff account:
corepack pnpm staff:grant reviewer@synthetic.invalid admin
```

The command accepts a registered local UUID or synthetic email and audits grants.
It only accepts a loopback `_dev` database. There is no public staff-assignment or
email-search endpoint. Open `/ops` as the reviewer; review another account's photos.
The member then refreshes `/app` and completes onboarding. Moderators cannot
approve their own photos. Browser tests use isolated `_test` storage/database.

Development terms/privacy and self-asserted age are not launch-ready legal or
verification controls. Deletion disables immediately; complete erasure is M5.
The code refuses account APIs on a non-loopback application origin.
