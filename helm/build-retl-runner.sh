#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="${1:-jitsucom/retl-runner:dev}"

cd "$PROJECT_ROOT"
pnpm --filter @jitsu-internal/retl-runner build
docker build --file "$SCRIPT_DIR/retl-runner.Dockerfile" \
  --tag "$IMAGE" "$PROJECT_ROOT/services/retl-runner/dist"
minikube -p minikube image load "$IMAGE"
echo "Reverse ETL runner loaded into minikube: $IMAGE"
