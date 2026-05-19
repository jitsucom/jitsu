#!/usr/bin/env bash

DATE_TAG=$(date +"%Y%m%d%H%M")
IMAGE="jitsucom/sidecar:dev-${DATE_TAG}"

echo "Building sidecar image: $IMAGE"

docker buildx build --platform linux/arm64 -f sidecar.Dockerfile -t "$IMAGE" --push .

echo "Loading image into minikube..."

minikube image load --overwrite=true "$IMAGE"

echo "Done: $IMAGE"
