#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/scripts/cluster-env.sh"

docker image inspect "$IMAGE" >/dev/null

if kind get clusters | grep -qx "$CLUSTER_NAME"; then
  echo "kind cluster ${CLUSTER_NAME} already exists"
else
  kind create cluster --name "$CLUSTER_NAME" --config "$ROOT/k8s/kind-config.yaml" --wait 180s
fi

kind load docker-image "$IMAGE" --name "$CLUSTER_NAME"
kubectl --context "$KUBE_CONTEXT" wait --for=condition=Ready node --all --timeout=180s
