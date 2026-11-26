#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/scripts/cluster-env.sh"

kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" wait --for=condition=Available "deploy/${DEPLOYMENT}" --timeout=180s >&2
kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" wait --for=condition=Ready pod -l app=marketplace --timeout=180s >&2

healthy="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get pods -l app=marketplace -o json | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const doc = JSON.parse(raw);
  let n = 0;
  for (const pod of doc.items || []) {
    const cond = (pod.status.conditions || []).find((item) => item.type === "Ready");
    if (pod.status.phase === "Running" && cond && cond.status === "True") n += 1;
  }
  process.stdout.write(String(n));
});
')"

min_available="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get pdb "$PDB_NAME" -o jsonpath='{.spec.minAvailable}')"

names="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get pods -l app=marketplace --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')"
pod_a="$(printf '%s\n' "$names" | sed -n '1p')"
pod_b="$(printf '%s\n' "$names" | sed -n '2p')"
if [[ -z "$pod_a" || -z "$pod_b" ]]; then
  echo "need two running pods to measure the disruption budget" >&2
  exit 1
fi

proxy_port=18080
kubectl --context "$KUBE_CONTEXT" proxy --port="$proxy_port" >"$ROOT/.kubectl-proxy.log" 2>&1 &
proxy_pid=$!
cleanup() {
  if [[ -n "${proxy_pid:-}" ]]; then
    kill "$proxy_pid" >/dev/null 2>&1 || true
    wait "$proxy_pid" >/dev/null 2>&1 || true
  fi
  rm -f "$ROOT/.kubectl-proxy.log"
}
trap cleanup EXIT

i=0
while [[ "$i" -lt 50 ]]; do
  if curl -sf "http://127.0.0.1:${proxy_port}/api/v1" >/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 0.1
done

evict() {
  body="$(mktemp)"
  printf '{"apiVersion":"policy/v1","kind":"Eviction","metadata":{"name":"%s","namespace":"%s"}}\n' "$1" "$NAMESPACE" >"$body"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary @"$body" "http://127.0.0.1:${proxy_port}/api/v1/namespaces/${NAMESPACE}/pods/${1}/eviction" || true)"
  rm -f "$body"
  printf '%s' "$code"
}

code_a="$(evict "$pod_a")"
code_b="$(evict "$pod_b")"

printf 'healthy=%s\n' "$healthy"
printf 'minAvailable=%s\n' "$min_available"
printf 'evict-1=%s\n' "$code_a"
printf 'evict-2=%s\n' "$code_b"

i=0
while [[ "$i" -lt 60 ]]; do
  ready_now="$(kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" get pods -l app=marketplace -o json | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const doc = JSON.parse(raw);
  let n = 0;
  for (const pod of doc.items || []) {
    if (pod.metadata.deletionTimestamp) continue;
    const cond = (pod.status.conditions || []).find((item) => item.type === "Ready");
    if (pod.status.phase === "Running" && cond && cond.status === "True") n += 1;
  }
  process.stdout.write(String(n));
});
')"
  if [[ "$ready_now" -ge 2 ]]; then
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
echo "cluster did not return to two ready pods after eviction" >&2
exit 1
