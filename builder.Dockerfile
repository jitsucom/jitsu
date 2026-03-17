FROM node:24-bookworm-slim

# Install Node.js 24 manually from NodeSource + all runtime dependencies
# This includes everything needed for building AND running the final images
RUN apt-get update && \
    apt-get install -y ca-certificates gnupg git curl telnet python3 g++ make jq nano cron bash netcat-traditional procps unzip && \
    rm -rf /var/lib/apt/lists/* && \
    npm -g install pnpm@10 && \
    npm cache clean --force && \
    ARCH=$(uname -m) && \
    curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${ARCH}-unknown-linux-gnu.zip" -o /tmp/deno.zip && \
    unzip -o /tmp/deno.zip -d /usr/local/bin && \
    chmod +x /usr/local/bin/deno && \
    rm /tmp/deno.zip

#print current user
RUN whoami && echo "Current user is $(whoami)"

# Set up pnpm global bin directory (for global package installs like Playwright)
# Note: This does NOT affect the store location, which remains at /root/.local/share/pnpm/store
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
# Override pnpm store location to avoid workspace-local stores
ENV NPM_CONFIG_STORE_DIR=/pnpm-store

# Copy only the files needed for dependency fetching and Playwright version extraction
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY libs/jitsu-js/package.json ./libs/jitsu-js/package.json

# Extract Playwright version before cleanup
RUN PLAYWRIGHT_VERSION=$(jq -r '.devDependencies["@playwright/test"]' ./libs/jitsu-js/package.json) && \
    echo "${PLAYWRIGHT_VERSION}" > /tmp/playwright-version.txt && \
    echo "Playwright version to install: ${PLAYWRIGHT_VERSION}"

# Fetch pnpm dependencies (only populates the store, doesn't create node_modules)
# This populates the pnpm store at /pnpm-store
# The store will be available to all.Dockerfile when it uses this image as builder
# Use --ignore-scripts to skip compilation - only fetch source packages
RUN pnpm fetch --ignore-scripts --loglevel debug --verbose
RUN rm -rf /package.json /pnpm-lock.yaml /pnpm-workspace.yaml /libs

# Install Playwright globally with pnpm
RUN PLAYWRIGHT_VERSION=$(cat /tmp/playwright-version.txt) && \
    echo "Installing Playwright version: ${PLAYWRIGHT_VERSION}" && \
    pnpm add --global playwright@${PLAYWRIGHT_VERSION} && \
    playwright install chromium  --with-deps --only-shell

# Clean up any leftover node_modules
RUN rm -rf /node_modules


RUN  apt-get clean && rm -rf /var/lib/apt/lists/*

