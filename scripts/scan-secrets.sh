#!/usr/bin/env bash
set -euo pipefail
# Full fetched history on EVERY run, including the initial baseline. Never upload findings.
scan_root="$(git rev-parse --show-toplevel)"
scan_temp="$(mktemp -d)"
trap 'rm -rf -- "$scan_temp"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
  --output "$scan_temp/gitleaks.tar.gz"
printf '%s  %s\n' 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb "$scan_temp/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$scan_temp/gitleaks.tar.gz" -C "$scan_temp" gitleaks
# Regression: detect a synthetic secret present only in an older commit, even in a test file.
mkdir "$scan_temp/fixture"
git -C "$scan_temp/fixture" init -q
git -C "$scan_temp/fixture" config user.name 'Synthetic scanner test'
git -C "$scan_temp/fixture" config user.email 'scanner@synthetic.invalid'
printf 'api_key = "%s"\n' "$(openssl rand -hex 32)" > "$scan_temp/fixture/test.ts"
git -C "$scan_temp/fixture" add test.ts
git -C "$scan_temp/fixture" commit -qm synthetic
git -C "$scan_temp/fixture" rm -q test.ts
git -C "$scan_temp/fixture" commit -qm removed
set +e
"$scan_temp/gitleaks" git "$scan_temp/fixture" --config "$scan_root/.gitleaks.toml" --log-opts=--all --redact=100 --no-banner >/dev/null 2>&1
fixture_exit=$?
set -e
if [ "$fixture_exit" -ne 1 ]; then echo 'Secret-scanner regression failed'; exit 2; fi
"$scan_temp/gitleaks" git "$scan_root" --config "$scan_root/.gitleaks.toml" --log-opts=--all --redact=100 --no-banner
