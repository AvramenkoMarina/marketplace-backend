#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

name="${1:?demo name}"
case "$name" in
  demo-publish|demo-dlq|demo-duplicate|demo-outbox|demo-crash-write|demo-crash-relay|demo-cache|demo-session|demo-ratelimit|demo-queue|demo-auth|demo-reuse|demo-rbac|demo-upload|demo-multipart|demo-cdn|demo-logs|demo-metrics|demo-trace) ;;
  *)
    echo "unknown demo: $name" >&2
    exit 1
    ;;
esac

"$ROOT/node_modules/.bin/tsc" -p "$ROOT/tsconfig.build.json"
exec node "$ROOT/dist/${name}.js"
