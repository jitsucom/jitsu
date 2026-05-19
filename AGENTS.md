# Jitsu — Agent Guidelines

## Project Overview

Jitsu is an open-source data pipeline platform (self-hosted Segment alternative). It
collects events from websites/apps and routes them to data warehouses and other
destinations.

## Repository Structure

This is a monorepo with two main technology stacks:

### Go (`/bulker`)

Data ingestion engine for streaming events to warehouses.

- `bulkerapp/` — main Bulker service
- `ingest/` — HTTP ingest endpoint
- `sync-controller/` — connector sync orchestration
- `bulkerlib/` — core ingestion library
- `connectors/` — warehouse connectors (ClickHouse, BigQuery, Redshift, Snowflake, S3,
  GCS, etc.)

### Node.js / TypeScript

**Services (`/services`)**
- `rotor/` — event routing, transformation, and function execution

**Web apps (`/webapps`)**
- `console/` — admin UI (Next.js)
- `ee-api/` — enterprise edition API (Next.js)

**Libraries (`/libs`)**
- `jitsu-js/` — browser JS SDK (`@jitsu/js`)
- `jitsu-react/` — React bindings (`@jitsu/jitsu-react`)
- `functions/` — functions runtime (`@jitsu/functions-lib`)
- `juava/` — shared utilities

**CLI (`/cli`)**
- `jitsu-cli/` — developer CLI (`jitsu-cli` on npm)

**Types (`/types`)**
- `protocols/` — shared TypeScript protocols (`@jitsu/protocols`)

## Tooling

- **Node.js:** pnpm ≥10 (workspace manager), Turbo (build orchestration), Node.js ≥22
- **Go:** Go 1.26 with Go workspaces (`go.work` at repo root)
- **Frontend:** Next.js, React 18, TypeScript, Tailwind CSS
- **Testing:** Jest (unit), Playwright (E2E), Go's built-in `testing`
- **CI:** GitHub Actions (`.github/workflows/`)

## Common Commands

```bash
# Install JS dependencies
pnpm install

# Generate Prisma client + zod schemas (required once after a fresh checkout
# or worktree). Skipping this leaves Turbopack panicking in
# ModuleGraphImportTracer::get_traces because it can't render the missing-
# module error for `prisma/schema`.
pnpm codegen

# Build all JS packages
pnpm build:turbo

# Type-check
pnpm typecheck:turbo

# Run unit tests
pnpm test

# Lint / format
pnpm lint
pnpm format

# Start all dev services (hot-reload)
pnpm dev

# Start only the console
pnpm console:dev
```

## Running the app for the user

If the user asks you to run the app (console / ee-api / dev stack), use:

- `pnpm console:dev` — only console
- `pnpm ee-api:dev` — only ee-api
- `pnpm ui:dev` — both, in parallel (turbo)

These go through [portless](https://portless.sh) and serve the apps at
`https://console.jitsu.localhost` and `https://ee.jitsu.localhost`.

**Branch hosting.** The dev wrapper auto-detects the current git branch and
suffixes the dev host with it: `https://console-$BRANCH.jitsu.localhost` /
`https://ee-$BRANCH.jitsu.localhost`. This avoids cookie / port collisions with
whatever the user has running from another branch.

- The repo's default branch (resolved via `git rev-parse origin/HEAD`) gets no
  suffix.
- The branch name is sanitized for DNS (lowercased, non-`[a-z0-9-]` → `-`,
  collapsed, capped at 30 chars).
- `pnpm console:dev --no-branch` disables the suffix (use the bare
  `console.jitsu.localhost` host).

If the user explicitly asks you not to use a branch suffix, pass `--no-branch`.

> Implementation note: `dev-scripts/src/bin/run-app.ts` loads root `.env` /
> `.env.local`, computes the slug, and runs portless from a non-git scratch dir
> with `--name <slug>` and a `bash -c "cd <ws> && <cmd>"` wrapper — sidesteps
> portless's hardcoded dot-style worktree prefix.

`portless` is a workspace devDependency — `pnpm install` is enough, no global
install. First-run on a machine prompts once for `sudo` to bind port 443 and
trust the local CA.

## Dev scripts

The `dev-scripts` package (`./dev-scripts`) hosts repo-wide developer tooling.
Invoke via `pnpm dev <subcommand>`:

```bash
pnpm dev                            # turbo run dev (start everything)
pnpm dev copy-db --src URL --dst URL   # rsync-style postgres copy ($ENV_VAR placeholders)
pnpm dev help
```

For Go (run inside `/bulker`):

```bash
go build ./...
go test ./...
```

## Git Workflow

When you need to create branches, make commits, or open pull requests, read
[CONTRIBUTING.md](CONTRIBUTING.md) first. No need to read it for code exploration —
only when interacting with git.
