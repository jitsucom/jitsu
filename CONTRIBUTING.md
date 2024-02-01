# Prerequisites

- `node: 18.x`
- `npx`
- `pnpm: >= 8.2.0`
- `docker: >= 19.03.0`

# Commands

- `pnpm install` - Install dependencies
- `pnpm build` - Build the project
- `pnpm format` - Apply prettier to the project, only to changed files
  - `pnpm format:check` - Check if prettier needs to be applied, check only changed files
  - `pnpm format:check:all` - Check if prettier needs to be applied. Check all files
  - `pnpm format:all` - Same as `pnpm format`, but check all files, regardless of changes
- `pnpm lint` - Run linter
- `pnpm test` - Run tests
- CI runs equivalent of `pnpm install && pnpm format:check:all && pnpm build && pnpm lint && pnpm test`.
- `pnpm factory-reset` - if you have any problems


# Releasing NPM packages

We use [monorel](https://github.com/jitsucom/monorel) to publish releases to npm.

## Packages

- `@jitsu/protocols` (./types/protocols) - Base types for JS and React SDKs and Functions library
- `@jitsu/jitsu-react` (./libs/jitsu-react) - React SDK
- `@jitsu/js` (./libs/jitsu-js) - JS SDK
- `@jitsu/functions-lib` (./libs/functions) - library for Jitsu Functions
- `@jitsu/jitsu-cli` (./cli/jitsu-cli) - CLI to create, debug and deploy Jitsu Functions

To avoid confusion, always release all npm packages together, even if only one of them has changes.

## Common steps

 - Check if you're logged in with `npm whoami`, if not, run `npm login`  
 - `pnpm install && pnpm format:check && pnpm build && pnpm lint && pnpm test` should succeed
 - All changes should be committed (check with `git status`). It's ok to release canary from branches!

## Canary releases

 - `pnpm release:canary` - to **dry-run** publishing
 - Same command, but with `pnpm release:canary --publish` - to **publish**.


## Stable releases

- `pnpm release --version <put a version here>` - to **dry-run** publishing
- Same command, but with `--publish` - to **publish**.


# Releasing Docker packages

We use [build-scripts](https://github.com/jitsucom/jitsu/tree/newjitsu/cli/build-scripts) along with `all.Dockerfile` to publish releases to Docker.

## Packages

- `jitsucom/console` (./webapps/console) - UI for Jitsu
- `jitsucom/rotor` (./services/rotor) - Functions Server for Jitsu

To avoid confusion, always release all packages together, even if only one of them has changes.

## Common steps

- Make sure that you are logged to your docker account `docker login`
- `pnpm install && pnpm format:check && pnpm build && pnpm lint && pnpm test` should succeed
- All changes should be committed (check with `git status`). It's ok to release canary from branches!

## Beta releases

- `./release.sh --dryRun` - to **dry-run** publishing.
- `./release.sh` - to actually **publish** beta.

## Stable releases

- `./release.sh --release latest --dryRun` - to **dry-run** publishing.
- `./release.sh --release latest ` - to actually **publish** latest image.

## Bumping versions

For initial release or to bump major/minor version pass `--version` argument to `./release.sh` script.

- `./release.sh --version 2.5.0`
- `./release.sh --release latest --version 2.5.0`



  
