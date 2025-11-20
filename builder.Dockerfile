FROM debian:bookworm-slim

# Install Node.js 24 manually from NodeSource + all runtime dependencies
# This includes everything needed for building AND running the final images
RUN apt-get update && \
    apt-get install -y ca-certificates curl gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    apt-get install -y git curl telnet python3 g++ make jq nano cron bash netcat-traditional procps && \
    rm -rf /var/lib/apt/lists/* && \
    npm -g install pnpm@10 && \
    npm cache clean --force

# Set up pnpm global bin directory (for global package installs like Playwright)
# Note: This does NOT affect the store location, which remains at /root/.local/share/pnpm/store
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
# Override pnpm store location to avoid workspace-local stores
ENV NPM_CONFIG_STORE_DIR=/pnpm-store

# Copy only the files needed for dependency fetching and Playwright version extraction
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY libs/jitsu-js/package.json ./libs/jitsu-js/package.json

# Install minimal Chromium dependencies manually
RUN apt-get update && \
    apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Extract Playwright version before cleanup
RUN PLAYWRIGHT_VERSION=$(jq -r '.devDependencies["@playwright/test"]' ./libs/jitsu-js/package.json) && \
    echo "${PLAYWRIGHT_VERSION}" > /tmp/playwright-version.txt && \
    echo "Playwright version to install: ${PLAYWRIGHT_VERSION}"

# Fetch pnpm dependencies (only populates the store, doesn't create node_modules)
# This populates the pnpm store at /pnpm-store
# The store will be available to all.Dockerfile when it uses this image as builder
# Use --ignore-scripts to skip compilation - only fetch source packages
RUN echo "pnpm store path: $(pnpm store path)" && pnpm fetch --ignore-scripts && \
    rm -rf /package.json /pnpm-lock.yaml /pnpm-workspace.yaml /libs

# Install Playwright globally with pnpm
RUN PLAYWRIGHT_VERSION=$(cat /tmp/playwright-version.txt) && \
    echo "Installing Playwright version: ${PLAYWRIGHT_VERSION}" && \
    pnpm add --global playwright@${PLAYWRIGHT_VERSION} && \
    playwright install chromium

# Clean up any leftover node_modules
RUN rm -rf /node_modules


RUN  apt-get clean && rm -rf /var/lib/apt/lists/*

