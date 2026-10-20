#!/usr/bin/env bash
# M0 native Ubuntu 24.04 / Debian-family fallback. Real Postgres + PostGIS only.
# Installs dependencies and creates synthetic local databases; does not drop data.
set -euo pipefail
if ! command -v apt-get >/dev/null; then
  echo 'Native setup supports apt-based Linux. Use Docker Compose on other systems.' >&2; exit 1
fi
if [ "$(id -u)" -eq 0 ]; then SUDO=(); else SUDO=(sudo); fi
"${SUDO[@]}" apt-get update
"${SUDO[@]}" apt-get install -y postgresql-16 postgresql-client-16 postgresql-16-postgis-3 ca-certificates curl tar
"${SUDO[@]}" pg_ctlcluster 16 main start || "${SUDO[@]}" pg_isready -p 5432
"${SUDO[@]}" runuser -u postgres -- psql -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE ROLE meetwell_dev LOGIN SUPERUSER PASSWORD ''local-development-only'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'meetwell_dev') \gexec
SELECT 'CREATE ROLE meetwell_worker_dev LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ''local-worker-only'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'meetwell_worker_dev') \gexec
SELECT 'CREATE DATABASE meetwell_dev OWNER meetwell_dev'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'meetwell_dev') \gexec
SELECT 'CREATE DATABASE meetwell_test OWNER meetwell_dev'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'meetwell_test') \gexec
SQL
bash "$(dirname "$0")/install-local-services.sh"
printf '%s\n' 'Native services installed. Copy .env.example to .env, run pnpm db:migrate, then pnpm db:grant-local-worker.'
