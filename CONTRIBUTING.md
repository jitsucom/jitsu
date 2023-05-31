# Prerequisites

- `node: 16.x`
- `pnpm: >= 7.15.0`

# Commands

- `pnpm install` - Install dependencies
- `pnpm build` - Build the project
- `pnpm format` - Apply prettier to the project
  - `pnpm format:check` - Check if prettier needs to be applied
- `pnpm lint` - Run linter
- `pnpm test` - Run tests
- CI runs equivalent of `pnpm install && pnpm format:check && pnpm build && pnpm lint && pnpm test`.
- `pnpm factory-reset` - if you have any problems


# Releasing

We use [monorel](https://github.com/jitsu/monorel) to publish releases.  At the moment only `@jitsu/jitsu-react`, and `@jitsu/js` are published to npm. To avoid confusion, 
always release them together, even if only one of them has changes.

## Common steps

 - Check if you're logged in with `npm whoami`, if not, run `npm login`  
 - `pnpm install && pnpm format:check && pnpm build && pnpm lint && pnpm test` should succeed
 - All changes should be committed (check with `git status`). It's ok to release canary from branches!

## Canary releases

 - `pnpm exec monorel  --filter '@jitsu/js' --filter '@jitsu/jitsu-react' --filter '@jitsu/protocols' --version '1.1.0-canary.{rev}.{time}' --npm-tag canary` - to **dry-run** publishing
 - Same command, but with `--publish` - to **publish**.

> **Note**
> Replace `1.1.0` in `--version '1.1.0-canary.{rev}'` to the version that makes sense

## Stable releases

- `pnpm exec monorel  --filter '@jitsu/js' --filter '@jitsu/jitsu-react' --filter '@jitsu/protocols' --version '**<put new version>**' --npm-tag latest` - to **dry-run** publishing
- Same command, but with `--publish` - to **publish**.

  
