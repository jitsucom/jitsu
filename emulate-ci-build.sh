#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# Cleanup function
cleanup() {

    if docker ps -a --format '{{.Names}}' | grep -q '^builder-ci$'; then
        log_info "Cleaning up builder-ci container..."
        docker stop builder-ci >/dev/null 2>&1 || true
        docker rm builder-ci >/dev/null 2>&1 || true
    fi
}

# Ensure cleanup happens on exit (success or failure)
trap cleanup EXIT

# Parse arguments
BUILD_BUILDER=false
NO_CACHE=false
SKIP_LINT=false
TARGETS="console rotor profiles"
for arg in "$@"; do
    case "$arg" in
        --build-builder)
            BUILD_BUILDER=true
            ;;
        --no-cache)
            NO_CACHE=true
            ;;
        --skip-lint)
            SKIP_LINT=true
            ;;
        --target)
            shift
            TARGETS="$1"
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Emulates the CI build process locally"
            echo ""
            echo "Options:"
            echo "  --build-builder    Build the builder image from builder.Dockerfile (default: pull from hub)"
            echo "  --no-cache         Build Docker images without using cache"
            echo "  --skip-lint        Skip lint, format, and test steps - go straight to Docker builds"
            echo "  --target <name>    Build only specific target(s) (default: 'console rotor profiles')"
            echo "  --help, -h         Show this help message"
            echo ""
            echo "Example:"
            echo "  $0                              # Pull builder image and run full CI build"
            echo "  $0 --build-builder              # Build builder image locally and run CI build"
            echo "  $0 --no-cache                   # Run CI build without Docker cache"
            echo "  $0 --skip-lint                  # Skip lint/test, only build Docker images"
            echo "  $0 --target rotor               # Build only the rotor image"
            echo "  $0 --target \"console rotor\"     # Build console and rotor images"
            echo "  $0 --skip-lint --target rotor --no-cache  # Fast rotor-only clean build"
            exit 0
            ;;
    esac
    shift
done

log_info "Cleaning local "

# Generate version with timestamp
VERSION="local.$(date +%Y%m%d%H%M%S)"
SHORT_SHA=$(git rev-parse --short=7 HEAD 2>/dev/null || echo "unknown")

log_info "Starting CI build emulation"
log_info "Version: ${VERSION}"
log_info "Commit: ${SHORT_SHA}"
log_info "Targets: ${TARGETS}"
if [ "$NO_CACHE" == "true" ]; then
    log_warning "Docker cache disabled"
fi
if [ "$SKIP_LINT" == "true" ]; then
    log_warning "Skipping lint, format, and test steps"
fi

# Step 1: Build or pull the builder image
if [ "$SKIP_LINT" == "false" ] || [ "$BUILD_BUILDER" == "true" ]; then
    if [ "$BUILD_BUILDER" == "true" ]; then
        log_info "Building builder image..."
        BUILDER_CACHE_FLAG=""
        if [ "$NO_CACHE" == "true" ]; then
            BUILDER_CACHE_FLAG="--no-cache"
        fi
        docker build --progress=plain ${BUILDER_CACHE_FLAG} -f builder.Dockerfile -t jitsucom/jitsu-builder:latest .
        log_success "Builder image built successfully"
    else
        log_info "Pulling builder image from GitHub Container Registry..."
        docker pull jitsucom/jitsu-builder:latest
        log_success "Builder image pulled successfully"
    fi
fi

# Step 2: Emulate lint.yml workflow
if [ "$SKIP_LINT" == "false" ]; then
    log_info "Starting lint and test workflow..."

    # Remove existing builder container if it exists
    if docker ps -a --format '{{.Names}}' | grep -q '^builder-ci$'; then
        log_info "Removing existing builder-ci container..."
        docker stop builder-ci >/dev/null 2>&1 || true
        docker rm builder-ci >/dev/null 2>&1 || true
    fi

    # Start builder container
    log_info "Starting builder container..."
    docker run -d --name builder-ci -v "$(pwd)":/workspace -w /workspace -e CI=true jitsucom/jitsu-builder:latest tail -f /dev/null
    log_success "Builder container started"

    # Fetch dependencies from store
    docker exec builder-ci pnpm fetch
    log_success "Dependencies fetched"

    # Install dependencies
    log_info "Installing dependencies..."
    docker exec builder-ci pnpm install --frozen-lockfile
    log_success "Dependencies installed"

    # Check code format
    log_info "Checking code format..."
    docker exec builder-ci pnpm run format:check:all
    log_success "Code format check passed"

    # Run codegen
    log_info "Running codegen..."
    docker exec builder-ci pnpm codegen
    log_success "Codegen completed"

    # Run typecheck
    log_info "Running typecheck..."
    docker exec builder-ci pnpm typecheck
    log_success "Typecheck passed"

    # Run linter
    log_info "Running linter..."
    docker exec builder-ci pnpm lint
    log_success "Linter passed"

    # Run tests
    log_info "Running tests..."
    docker exec builder-ci pnpm test
    log_success "Tests passed"
fi

# Step 3: Emulate services.yaml workflow
log_info "Starting services Docker build..."

REGISTRY="jitsucom"

# Set cache flag for buildx
CACHE_FLAG=""
if [ "$NO_CACHE" == "true" ]; then
    CACHE_FLAG="--no-cache"
fi

for TARGET in $TARGETS; do
    log_info "Building ${TARGET}..."

    docker buildx build \
        --progress=plain \
        ${CACHE_FLAG} \
        --target ${TARGET} \
        --platform linux/amd64 \
        --build-arg JITSU_BUILD_VERSION=${VERSION} \
        --build-arg JITSU_BUILD_DOCKER_TAG=local \
        --build-arg JITSU_BUILD_COMMIT_SHA=${SHORT_SHA} \
        --build-arg CI=true \
        -t ${REGISTRY}/${TARGET}:${VERSION} \
        -t ${REGISTRY}/${TARGET}:local \
        -f all.Dockerfile \
        --load \
        .

    log_success "${TARGET} built successfully"
    log_info "Tagged as: ${REGISTRY}/${TARGET}:${VERSION}"
    log_info "Tagged as: ${REGISTRY}/${TARGET}:local"
done

log_success "All builds completed successfully!"
log_info ""
log_info "Built images:"
for TARGET in $TARGETS; do
    echo "  - ${REGISTRY}/${TARGET}:${VERSION}"
    echo "  - ${REGISTRY}/${TARGET}:local"
done
