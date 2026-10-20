#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/.local/logs" "$ROOT/.local/data/minio"
for service in minio mailpit; do
  if [ -f "$ROOT/.local/$service.pid" ] && kill -0 "$(cat "$ROOT/.local/$service.pid")" 2>/dev/null; then
    echo "$service already running; use stop-local-services.sh first" >&2; exit 1
  fi
done
MINIO_ROOT_USER=meetwell-local MINIO_ROOT_PASSWORD=local-storage-only nohup "$ROOT/.local/bin/minio" server "$ROOT/.local/data/minio" --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 >"$ROOT/.local/logs/minio.log" 2>&1 &
echo "$!" > "$ROOT/.local/minio.pid"
nohup "$ROOT/.local/bin/mailpit" --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 >"$ROOT/.local/logs/mailpit.log" 2>&1 &
echo "$!" > "$ROOT/.local/mailpit.pid"
for endpoint in http://127.0.0.1:9000/minio/health/live http://127.0.0.1:8025/readyz; do
  curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-connrefused "$endpoint" >/dev/null
done
printf '%s\n' 'MinIO and Mailpit are healthy on loopback.'
