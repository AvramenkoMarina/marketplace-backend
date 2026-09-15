set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRET_FILE="${ROOT}/secrets/db_password"
COMPOSE=(docker compose -f "${ROOT}/docker-compose.yml")

if [[ ! -f "${SECRET_FILE}" ]]; then
  echo "Missing ${SECRET_FILE}" >&2
  exit 1
fi

NEW_PASSWORD="$(openssl rand -hex 16)"

echo "→ ALTER ROLE marketplace …"
"${COMPOSE[@]}" exec -T postgres \
  psql -U marketplace -d marketplace \
  -c "ALTER ROLE marketplace WITH PASSWORD '${NEW_PASSWORD}';"

echo "→ update ${SECRET_FILE}"
printf '%s' "${NEW_PASSWORD}" > "${SECRET_FILE}"

echo "→ pg_terminate_backend (force pool to open new connections)"
"${COMPOSE[@]}" exec -T postgres \
  psql -U marketplace -d marketplace \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();"

echo "Rotation done. API keeps running; next DB checkout re-reads the secret file."
