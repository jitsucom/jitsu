# Multi-stage Dockerfile for building Jitsu services (console, rotor, profiles)
#
# Usage:
#   docker buildx build --target console -t jitsucom/console:latest .
#   docker buildx build --target rotor -t jitsucom/rotor:latest .
#   docker buildx build --target profiles -t jitsucom/profiles:latest .
#
# Build with version info:
#   docker buildx build --target console \
#     --build-arg JITSU_BUILD_VERSION=1.0.0 \
#     --build-arg JITSU_BUILD_COMMIT_SHA=abc123 \
#     -t jitsucom/console:1.0.0 .

# ============================================================================
# BASE STAGE - Shared runtime image for all services
# ============================================================================
# This stage provides the minimal Node.js runtime environment
# Shared by all final service images (console, rotor, profiles)
FROM node:24-bookworm-slim AS base

WORKDIR /app

# Install runtime dependencies required by all services
# - nano, curl: debugging and healthchecks
# - cron: scheduled tasks for console
# - bash: shell scripting
# - netcat-traditional: network utilities
# - procps: process management (ps, top, etc.)
# - jq: JSON parsing for extracting package versions
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates nano curl cron bash netcat-traditional procps jq && \
    rm -rf /var/lib/apt/lists/*

# ============================================================================
# BUILDER STAGE - Build all TypeScript/JavaScript code
# ============================================================================
# Uses jitsu-builder image which has:
# - Node.js 24, pnpm 10, build tools (g++, make, python)
# - Pre-populated pnpm store with all dependencies at /pnpm-store
# - Playwright browsers pre-installed
FROM jitsucom/jitsu-builder:latest AS builder

ARG CI=false

WORKDIR /app

# STEP 1: Copy lockfiles and workspace config (smallest possible layer)
# This layer only invalidates when dependency versions change
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# STEP 2: Fetch dependencies into pnpm store
# The builder image already has most packages cached at /pnpm-store
# This step verifies the store and fetches any new/updated packages
# --ignore-scripts: Skip postinstall scripts (they run during install step)
RUN echo "pnpm store path: $(pnpm store path)" && pnpm fetch --ignore-scripts

# STEP 3: Copy only package.json files (not source code yet!)
# This optimization allows the install layer to be cached independently from source changes
# How it works:
#   1. Copy entire workspace to /tmp/src temporarily
#   2. Find all package.json files (excluding build artifacts)
#   3. Copy just the package.json files to /app, preserving directory structure
#   4. Delete /tmp/src to free up space
# Why: pnpm needs all package.json files to understand the workspace structure,
#      but doesn't need source code yet. This means editing .ts/.tsx files won't
#      invalidate the expensive install layer.
COPY . /tmp/src
RUN cd /tmp/src && \
    find . -name 'package.json' \
      -not -path '*/node_modules/*' \
      -not -path '*/.pnpm-store/*' \
      -not -path '*/dist/*' \
      -not -path '*/build/*' \
      -exec sh -c 'mkdir -p /app/$(dirname {}) && cp {} /app/{}' \; && \
    rm -rf /tmp/src

# STEP 4: Install dependencies (THIS LAYER IS CACHED!)
# This layer only invalidates when lockfile or any package.json changes
# Flags:
#   -r: install all workspace packages recursively
#   --frozen-lockfile: fail if lockfile needs updates (ensures reproducibility)
#   --prefer-offline: use cache when possible, but allow downloads for native modules
#   --unsafe-perm: allow postinstall scripts to run as root (needed for native module compilation)
RUN pnpm install -r --frozen-lockfile --prefer-offline --unsafe-perm

# STEP 5: Copy source code
# This layer invalidates on ANY source file change, but the install layer above remains cached
COPY . .

# STEP 6: Build all TypeScript/JavaScript code
# Environment variables:
#   NEXTJS_STANDALONE_BUILD=1: tells Next.js to create minimal standalone output
#   CI: some packages behave differently in CI (e.g., disable interactive prompts)
ENV NEXTJS_STANDALONE_BUILD=1
ENV CI=${CI}
# Note: pnpm build now includes building the management CLI (build:manage)
RUN pnpm build

# ============================================================================
# CONSOLE STAGE - Next.js web application with Prisma ORM
# ============================================================================
# The admin console for managing Jitsu (Next.js + Prisma)
FROM base AS console

# Build arguments passed from CI/CD or docker build command
# These become environment variables in the final image
ARG JITSU_BUILD_VERSION=dev,
ARG JITSU_BUILD_DOCKER_TAG=dev,
ARG JITSU_BUILD_COMMIT_SHA=unknown,

WORKDIR /app

# Install Prisma CLI globally (needed for database migrations at runtime)
# Why globally: Prisma needs to be available for migrations in docker-start-console.sh
# Why this approach: Extract exact version from package.json to ensure compatibility
# Steps:
#   1. Copy package.json to temporary location
#   2. Use jq to extract the exact prisma version from dependencies
#   3. Install that specific version globally
#   4. The temp file is discarded (no cleanup needed - happens in same layer)
COPY --from=builder /app/webapps/console/package.json /tmp/console-package.json
RUN npm -g install prisma@$(jq -r '.dependencies.prisma' /tmp/console-package.json)

# Copy startup script and Prisma schema
# docker-start-console.sh: Runs migrations and starts the server
# schema.prisma: Needed for Prisma CLI commands at runtime
COPY --from=builder /app/docker-start-console.sh ./
COPY --from=builder /app/webapps/console/prisma/schema.prisma ./

# Copy Next.js standalone build output
# Next.js standalone mode creates a minimal, self-contained server with only necessary files
# Why .next/standalone: Contains the server and minimal dependencies
# Why .next/static separate: Next.js requires static assets in specific location
# Why public separate: User-uploaded or public assets served by Next.js
COPY --from=builder /app/webapps/console/.next/standalone ./
COPY --from=builder /app/webapps/console/.next/static ./webapps/console/.next/static
COPY --from=builder /app/webapps/console/public ./webapps/console/public

# Copy management CLI script (bundled with esbuild)
# This allows running management commands like: node /app/webapps/console/build/manage.js seed
COPY --from=builder /app/webapps/console/build/manage.js ./webapps/console/build/

# Setup cron for scheduled tasks (e.g., cleanup, analytics aggregation)
# chmod 0644: cron requires specific permissions (owner read/write, others read)
# crontab: Install the cron schedule
COPY --from=builder /app/console.cron /etc/cron.d/console.cron
RUN chmod 0644 /etc/cron.d/console.cron
RUN crontab /etc/cron.d/console.cron

EXPOSE 3000

# Health check for container orchestration (Kubernetes, Docker Compose, etc.)
# Calls Next.js healthcheck endpoint every 30s (default)
HEALTHCHECK CMD curl --fail http://localhost:3000/api/healthcheck || exit 1

# Set environment variables for runtime
# NODE_ENV=production: Enables production optimizations in Node.js and Next.js
# JITSU_VERSION_*: Version info displayed in the UI and logs
ENV NODE_ENV=production
ENV JITSU_VERSION_COMMIT_SHA=${JITSU_BUILD_COMMIT_SHA}
ENV JITSU_VERSION_DOCKER_TAG=${JITSU_BUILD_DOCKER_TAG}
ENV JITSU_VERSION_STRING=${JITSU_BUILD_VERSION}

# Use shell to execute startup script (needed for environment variable substitution)
ENTRYPOINT ["sh", "-c", "/app/docker-start-console.sh"]

# ============================================================================
# ROTOR STAGE - Data ingestion and routing service
# ============================================================================
# High-throughput Node.js service for processing incoming events
FROM base AS rotor

# Build arguments for version information
ARG JITSU_BUILD_VERSION=dev,
ARG JITSU_BUILD_DOCKER_TAG=dev,
ARG JITSU_BUILD_COMMIT_SHA=unknown,

WORKDIR /app

# Create non-root user for security best practices
# Why: Running as root in containers is a security risk
# GID/UID 1001: Arbitrary non-privileged IDs (common convention)
# --system: Creates a system user (no password, no login shell)
RUN addgroup --system --gid 1001 runner
RUN adduser --system --uid 1001 runner
USER runner

EXPOSE 3401

# Copy compiled JavaScript from builder stage
# The /dist folder contains the bundled Node.js application
COPY --from=builder /app/services/rotor/dist .
COPY --from=builder /app/services/rotor/entrypoint.sh .

# Runtime environment configuration
ENV NODE_ENV=production
ENV JITSU_VERSION_COMMIT_SHA=${JITSU_BUILD_COMMIT_SHA}
ENV JITSU_VERSION_DOCKER_TAG=${JITSU_BUILD_DOCKER_TAG}
ENV JITSU_VERSION_STRING=${JITSU_BUILD_VERSION}


ENTRYPOINT ["/app/entrypoint.sh"]
