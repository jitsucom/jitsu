# Prerequisites

- `node: >=22`
- `npx`
- `pnpm: >= 10`
- `docker: >= 19.03.0`

# Commands

- `pnpm install` - Install dependencies
- `pnpm build` - Build the project
- `pnpm format` - Apply prettier to the project, only to changed files
  - `pnpm format:check` - Check if prettier needs to be applied, check only changed files
  - `pnpm format:check:all` - Check if prettier needs to be applied. Check all files
  - `pnpm format:all` - Same as `pnpm format`, but check all files, regardless of changes
- `pnpm typecheck` - Run typecheck
- `pnpm lint` - Run linter
- `pnpm test` - Run tests

# Local Dev Env

Run 
 * `docker compose -f ./docker/docker-compose.yml up --force-recreate` to start all dependencies required to run Jitsu. 
 * `docker compose -f ./docker/docker-compose.yml up --profile jitsu-services-dev --force-recreate` - to run dependencies + all Jitsu services
in a hot reload mode, see `docker/README.md`

# Environment variables

Every node process spawned by a pnpm script auto-loads two layered `.env.local` files
(later wins; existing `process.env` always wins over both, missing files skipped silently):

1. `~/.jitsu/.env.local` — shared across all worktrees of all branches (Firebase, Stripe,
   OIDC, GitHub OAuth — anything that doesn't change per branch).
2. `<repo>/.env.local` — per-worktree (`DATABASE_URL`, `NEXTAUTH_URL`, `AUTH_COOKIE_DOMAIN`,
   anything that should differ between two worktrees of two PRs).

**No wrapper.** `node --inspect script.js` and your debugger attach to the script's own
process directly — there's no `dotenv-cli` parent in the tree.

`.env.example` documents the variables the apps expect. Runtime defaults belong in code
(`process.env.FOO ?? "default"`), not in a tracked `.env`.

## How it works

The root [`.npmrc`](.npmrc) sets `node-options=--require=env-preload`,
so pnpm exports `NODE_OPTIONS=--require=...` for every node process it spawns from a
script. The preload ([`env-preload/preload-env.cjs`](env-preload/preload-env.cjs)) loads
`~/.jitsu/.env.local`, then walks up from `process.cwd()` to find `pnpm-workspace.yaml`
and load the repo-root `.env.local`. (Why a preload instead of `--env-file-if-exists`:
Node disallows `--env-file*` in `NODE_OPTIONS` for security; `--require` is allowed.)

## Adding to the shared layer

```bash
mkdir -p ~/.jitsu && chmod 700 ~/.jitsu
touch ~/.jitsu/.env.local && chmod 600 ~/.jitsu/.env.local
echo 'STRIPE_KEY=sk_live_xxx' >> ~/.jitsu/.env.local
```

# Development Workflow

## Development Branch

The default development branch is `newjitsu`.

## Common Principles

**Branch naming:** Use a type prefix — `feat/`, `fix/`, `chore/`. Example: `feat/workspace-oidc`.

**Merging policy:** When working on a feature branch, never merge the default branch into
it — always rebase your branch onto the latest default branch. When merging a PR into the
default branch, either "Create a merge commit" (the default) or "Rebase and merge" is fine.
Squash merge stays off; if you want to squash overly granular commits, do it locally before
opening the PR.

**Commit style:** [Conventional commits](https://www.conventionalcommits.org/) —
`type(scope): description`. Common types: `fix`, `feat`, `chore`, `refactor`, `ci`.
Examples: `fix(rotor): enable DNS caching for undici pools`,
`feat(console): add workspace OIDC configuration`.

## PRs vs Direct Commits

Trivial changes, bug fixes, and config updates go directly to `newjitsu`. Larger or
riskier changes use pull requests. The engineer decides based on complexity and risk.

## CI Checks

[lint.yml](.github/workflows/lint.yml) runs on every push and PR:

- Prettier format check, TypeScript typecheck, ESLint
- Jest unit tests
- Playwright E2E tests (frontend changes only)
- Go integration tests against real cloud warehouses (AWS S3, BigQuery, Redshift, Snowflake)

## AI Review

[ai-review.yml](.github/workflows/ai-review.yml) runs on every PR and on direct pushes
to `newjitsu`. It uses OpenAI Codex to check for bugs, security issues, and correctness
problems — style nitpicks are skipped. For PRs it posts a review via a GitHub App. For
direct commits it posts a commit comment.

## Release

There are two independent release pipelines with separate versioning.

**Services & CLI tools** — Docker images for backend services (console, rotor,
functions-server, bulker, ingest, and others) and NPM packages (`jitsu-cli`,
`@jitsu/functions-lib`). Managed by
[services.yaml](.github/workflows/services.yaml).
Base version in [.services.version.json](.services.version.json).

**Client libraries** — NPM packages `@jitsu/js`, `@jitsu/jitsu-react`,
`@jitsu/protocols`. Managed by
[client-libraries.yaml](.github/workflows/client-libraries.yaml).
Base version in [.jsclient.version.json](.jsclient.version.json).

Each pipeline publishes to three channels determined by the branch:

| Pipeline         | `newjitsu`              | `stable-services`  | `stable-jsclient`  | Any other branch                          |
|------------------|-------------------------|--------------------|--------------------|-------------------------------------------|
| Services & CLI   | beta — `2.14.1-beta.N`  | stable — `2.14.1`  | —                  | canary — `2.14.1-canary.20260416.abc1234` |
| Client libraries | beta — `1.11.0-beta.N`  | —                  | stable — `1.11.0`  | canary — `1.11.0-canary.20260416.abc1234` |

- **Stable** — `X.Y.Z`
- **Beta** — `X.Y.Z-beta.N`, where `N` is auto-incremented based on existing git tags
- **Canary** — `X.Y.Z-canary.YYYYMMDD.shortsha` — no git tag or GitHub release created
- The base version `X.Y` is defined in `.services.version.json` or `.jsclient.version.json`;
  `Z` is the patch number, incremented per release

Builds are triggered automatically by [lint.yml](.github/workflows/lint.yml) after tests
pass on `newjitsu` or the stable branches. On a successful beta or stable release, a
GitHub release is created and the infra repo is notified via webhook to update deployment
configs.
