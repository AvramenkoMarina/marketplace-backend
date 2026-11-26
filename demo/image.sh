#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/scripts/cluster-env.sh"
cd "$ROOT"

token="$ROOT/.npm_token"
if [[ ! -s "$token" ]]; then
  echo "missing .npm_token; the build-secret measurement has nothing to search for" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/save"

docker image inspect "$IMAGE" >"$tmp/inspect.json"
docker history --no-trunc --format '{{.CreatedBy}}' "$IMAGE" >"$tmp/history.txt"
docker save "$IMAGE" | tar -C "$tmp/save" -xf -

set +e
docker run --rm --entrypoint sh "$IMAGE" -c true >"$tmp/shell.out" 2>&1
shell_rc=$?
set -e
if [[ "$shell_rc" -eq 0 ]]; then
  shell_inside=1
else
  if grep -qiE 'Cannot connect to the Docker daemon|error during connect' "$tmp/shell.out"; then
    cat "$tmp/shell.out" >&2
    exit 1
  fi
  shell_inside=0
fi

SHELL_INSIDE="$shell_inside" node "$ROOT/scripts/image-measure.mjs" \
  "$ROOT/docker/Dockerfile" \
  "$tmp/history.txt" \
  "$tmp/inspect.json" \
  "$tmp/save" \
  "$token"
