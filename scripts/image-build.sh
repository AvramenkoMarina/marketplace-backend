#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/scripts/cluster-env.sh"
cd "$ROOT"

if [[ ! -s "$ROOT/.npm_token" ]]; then
  echo "missing .npm_token (BuildKit secret for npm ci)" >&2
  exit 1
fi

DOCKER_BUILDKIT=1 docker build \
  --secret "id=npm_token,src=${ROOT}/.npm_token" \
  -f "$ROOT/docker/Dockerfile" \
  -t "$IMAGE" \
  "$ROOT"
