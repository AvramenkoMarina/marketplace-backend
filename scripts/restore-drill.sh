#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${DATABASE_URL:?unbound variable}"

rest="${DATABASE_URL#*://}"
userpass="${rest%%@*}"
hostpart="${rest#*@}"
PGUSER="${userpass%%:*}"
PGPASSWORD="${userpass#*:}"
PGDATABASE="${hostpart#*/}"
PGDATABASE="${PGDATABASE%%\?*}"
export PGPASSWORD

dump=""
if compgen -G "$ROOT/backups/marketplace-*.dump" >/dev/null; then
  dump="$(ls -1t "$ROOT"/backups/marketplace-*.dump | awk 'NR==1')"
fi
if [ -z "$dump" ]; then
  echo "no dump in $ROOT/backups" >&2
  exit 1
fi

FINGERPRINT="SELECT CASE WHEN to_regclass('public.orders') IS NULL THEN '0|0' ELSE (SELECT count(*)::text || '|' || COALESCE(SUM(COALESCE(NULLIF(to_jsonb(o)->>'total_cents','')::numeric, NULLIF(to_jsonb(o)->>'total','')::numeric, 0)), 0)::text FROM public.orders o) END;"

source_fp="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$FINGERPRINT")" || exit 1

name="marketplace-restore-drill"
vol="marketplace_restore_drill"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$vol" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker volume create "$vol" >/dev/null
docker run -d --name "$name" \
  -e POSTGRES_USER="$PGUSER" \
  -e POSTGRES_PASSWORD="$PGPASSWORD" \
  -e POSTGRES_DB="$PGDATABASE" \
  -v "$vol":/var/lib/postgresql/data \
  postgres:16-alpine >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$name" psql -U "$PGUSER" -d "$PGDATABASE" -Atc 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done
if [ "$ready" -ne 1 ]; then
  echo "restore postgres did not become ready" >&2
  exit 1
fi

SECONDS=0
docker exec -i "$name" \
  pg_restore -U "$PGUSER" -d "$PGDATABASE" --no-owner --no-privileges --exit-on-error \
  <"$dump"
echo "restore_seconds: ${SECONDS}"

restored_fp="$(docker exec "$name" psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -Atc "$FINGERPRINT")" || exit 1

echo "dump: $dump"
echo "source: $source_fp"
echo "restored: $restored_fp"

if [ "$source_fp" = "$restored_fp" ]; then
  echo "MATCH"
else
  echo "MISMATCH" >&2
  exit 1
fi
