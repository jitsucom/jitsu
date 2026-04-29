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

# Development Workflow

## Development Branch

The default development branch is `newjitsu`.

## Common Principles

**Branch naming:** Use a type prefix — `feat/`, `fix/`, `chore/`. Example: `feat/workspace-oidc`.

**Merging policy:** We avoid merge commits. Always rebase onto the default branch —
never merge the default branch into a branch. For PRs, merge with full history preserved
— no squash merge. It's fine to squash overly granular commits within a branch locally
before opening a PR.

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





  
