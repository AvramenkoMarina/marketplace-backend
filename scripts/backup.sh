#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${DATABASE_URL:?unbound variable}"

rest="${DATABASE_URL#*://}"
userpass="${rest%%@*}"
hostpart="${rest#*@}"
PGUSER="${userpass%%:*}"
PGDATABASE="${hostpart#*/}"
PGDATABASE="${PGDATABASE%%\?*}"

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
mkdir -p "$ROOT/backups"
out="$ROOT/backups/marketplace-${stamp}.dump"
partial="${out}.partial"

docker compose exec -T postgres \
  pg_dump -Fc --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE" \
  >"$partial"

mv "$partial" "$out"
echo "$out"
