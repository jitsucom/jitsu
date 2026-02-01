#!/bin/bash
set -e

# Build Rotor Docker image using all.Dockerfile
# Usage: ./build-image.sh [tag]
#   tag: Docker image tag (default: dev)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAG="${1:-devfs}"
IMAGE_NAME="${IMAGE_NAME:-jitsucom/rotor}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

## Use minikube's docker daemon if available
#if command -v minikube &> /dev/null && minikube status &> /dev/null; then
#    log_info "Using minikube's Docker daemon..."
#    eval $(minikube docker-env)
#fi

log_info "Building rotor image: ${IMAGE_NAME}:${TAG}"
cd "$PROJECT_ROOT"

docker buildx build \
    --target rotor \
    --build-arg JITSU_BUILD_VERSION="${TAG}" \
    --build-arg JITSU_BUILD_DOCKER_TAG="${TAG}" \
    --build-arg JITSU_BUILD_COMMIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')" \
    -t "${IMAGE_NAME}:${TAG}" \
    -f all.Dockerfile \
    --load \
    .

minikube image load jitsucom/rotor:devfs2

log_info "Done! Image: ${IMAGE_NAME}:${TAG}"
