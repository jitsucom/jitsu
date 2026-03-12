#!/bin/bash
set -e

DATE_TAG=$(date +"%Y%m%d%H%M")
IMAGE="jitsucom/rotor:dev-${DATE_TAG}"

echo "Building rotor image..."
docker buildx build \
  --target rotor \
  --progress=plain \
  --load \
  -t "$IMAGE" \
  -f all.Dockerfile \
  .

echo "Loading image into minikube..."
minikube image load --overwrite=true "$IMAGE"

echo "Done: $IMAGE"
