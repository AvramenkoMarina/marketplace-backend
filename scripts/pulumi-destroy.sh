#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/scripts/cluster-env.sh"

: "${PULUMI_BACKEND_URL:?PULUMI_BACKEND_URL is required}"
: "${PULUMI_CONFIG_PASSPHRASE:?PULUMI_CONFIG_PASSPHRASE is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

export PULUMI_SKIP_UPDATE_CHECK=1
export APP_IMAGE="$IMAGE"

backend_dir="${PULUMI_BACKEND_URL#file://}"
mkdir -p "$backend_dir"

cd "$ROOT/infra"
pulumi login "$PULUMI_BACKEND_URL"
pulumi stack select dev --non-interactive
pulumi destroy --yes --non-interactive --stack dev
