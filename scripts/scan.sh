#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/scripts/cluster-env.sh"

: "${SCAN_MAX:?SCAN_MAX is required}"

report="$(mktemp)"
cache="$ROOT/.trivy-cache"
mkdir -p "$cache"
trap 'rm -f "$report"' EXIT

docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$cache:/root/.cache" \
  aquasec/trivy:0.58.2 image \
  --severity CRITICAL,HIGH \
  --format json \
  --quiet \
  --timeout 10m \
  "$IMAGE" >"$report"

APP_IMAGE="$IMAGE" SCAN_MAX="$SCAN_MAX" node "$ROOT/scripts/scan-gate.mjs" "$report"
