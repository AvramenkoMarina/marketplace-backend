CLUSTER_NAME=marketplace
KUBE_CONTEXT="${KUBE_CONTEXT:-kind-marketplace}"
NAMESPACE=marketplace
DEPLOYMENT=marketplace
PDB_NAME=marketplace
HPA_NAME=marketplace
IMAGE="${APP_IMAGE:-marketplace-api:hw28}"
HOST_PORT=30080
export APP_IMAGE="$IMAGE"
export KUBE_CONTEXT
