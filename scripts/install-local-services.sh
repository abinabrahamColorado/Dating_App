#!/usr/bin/env bash
# Exact upstream versions; MinIO stopped distributing this release as a Linux binary.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -s)-$(uname -m)" in Linux-x86_64) ;; *) echo 'Native service installer supports Linux x86_64. Use Compose otherwise.' >&2; exit 1 ;; esac
mkdir -p "$ROOT/.local/bin" "$ROOT/.local/src" "$ROOT/.local/data/minio" "$ROOT/.local/logs"
if ! command -v go >/dev/null || ! command -v git >/dev/null; then
  if [ "$(id -u)" -eq 0 ]; then apt-get install -y golang-go git; else sudo apt-get install -y golang-go git; fi
fi
MINIO_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a
MINIO_SOURCE="$ROOT/.local/src/minio"
if [ ! -d "$MINIO_SOURCE/.git" ]; then git clone --filter=blob:none --no-checkout https://github.com/minio/minio.git "$MINIO_SOURCE"; fi
git -C "$MINIO_SOURCE" fetch origin "$MINIO_COMMIT"
git -C "$MINIO_SOURCE" checkout --detach "$MINIO_COMMIT"
(cd "$MINIO_SOURCE" && GOTOOLCHAIN=auto go build -o "$ROOT/.local/bin/minio" .)
curl -fL --retry 2 https://github.com/axllent/mailpit/releases/download/v1.31.6/mailpit-linux-amd64.tar.gz -o "$ROOT/.local/mailpit.tar.gz"
printf '%s  %s\n' 10fa12ccc610f653d4ed4df848c1817f9935dcf4e9a6a458a19ab0fa02093f91 "$ROOT/.local/mailpit.tar.gz" | sha256sum -c -
tar -xzf "$ROOT/.local/mailpit.tar.gz" -C "$ROOT/.local/bin" mailpit
printf '%s\n' 'Installed pinned MinIO and Mailpit. Run bash scripts/start-local-services.sh.'
