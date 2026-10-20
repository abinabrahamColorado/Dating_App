#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for service in minio mailpit; do
  if [ -f "$ROOT/.local/$service.pid" ]; then
    pid="$(cat "$ROOT/.local/$service.pid")"
    if [ -L "/proc/$pid/exe" ] && [ "$(readlink "/proc/$pid/exe")" = "$ROOT/.local/bin/$service" ]; then kill "$pid"; fi
    rm -f "$ROOT/.local/$service.pid"
  fi
done
