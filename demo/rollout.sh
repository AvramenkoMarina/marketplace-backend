#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/scripts/cluster-env.sh"
cd "$ROOT"

url="http://127.0.0.1:${HOST_PORT}/"
codes="$(mktemp)"
stop="$(mktemp)"
rm -f "$stop"
load_pid=""

cleanup() {
  if [[ -n "$load_pid" ]]; then
    touch "$stop"
    wait "$load_pid" 2>/dev/null || true
    load_pid=""
  fi
  rm -f "$codes" "$stop"
}
trap cleanup EXIT

echo "waiting for ${url}" >&2
ready=0
i=0
while [[ "$i" -lt 90 ]]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$url" || true)"
  if [[ "$code" == "200" ]]; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "service did not return 200 before the rollout measurement" >&2
  exit 1
fi

node "$ROOT/scripts/loadgen.mjs" "$url" "$codes" "$stop" &
load_pid=$!

before="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deploy "$DEPLOYMENT" -o jsonpath='{.spec.template.metadata.annotations.marketplace/rev}')"
start="$(date +%s)"
APP_REV="r$(date +%s)" bash "$ROOT/scripts/with-secrets.sh" dev bash "$ROOT/scripts/pulumi-up.sh" >&2
kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" rollout status "deploy/${DEPLOYMENT}" --timeout=180s >&2
end="$(date +%s)"
after="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get deploy "$DEPLOYMENT" -o jsonpath='{.spec.template.metadata.annotations.marketplace/rev}')"
if [[ "$before" == "$after" ]]; then
  echo "pod template rev did not change (${before}); rollout was not measured" >&2
  exit 1
fi

seconds=$((end - start))
deadline=$((SECONDS + 90))
while [[ "$(wc -l < "$codes" | tr -d ' ')" -lt 5000 ]]; do
  if [[ "$SECONDS" -ge "$deadline" ]]; then
    break
  fi
  sleep 0.5
done
sleep 1
touch "$stop"
wait "$load_pid" || true
load_pid=""

node "$ROOT/scripts/tally-rollout.mjs" "$codes" "$seconds"
