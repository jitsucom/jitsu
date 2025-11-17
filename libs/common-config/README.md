# @jitsu/common-config

Shared TypeScript configuration for the Jitsu monorepo. This package provides a base `tsconfig.json` that all workspace packages extend,
ensuring consistent TypeScript compilation settings across the entire codebase.

## ⚠️ IMPORTANT: When Using This Config

**Your `tsconfig.json` MUST include an explicit `"include"` field!**

The base config contains `"files": ["index.d.ts"]` to provide global type augmentations (like `Response.json()` returning
`Promise<any>`). If your child config doesn't have `"include"`, TypeScript will **only compile** `index.d.ts` and ignore
your source files.

```json
{
  "extends": "@jitsu/common-config/tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]  // ← REQUIRED! Without this, only index.d.ts gets compiled
}
```

**Why this happens:** When a parent tsconfig has `files`, child configs inherit that restriction unless they override
it with their own `files` or `include`.

## Why This Exists

Modern JavaScript has two module systems: **CommonJS (CJS)** and **ECMAScript Modules (ESM)**. This creates complexity when building TypeScript projects that need
to work with dependencies using either or both formats.

### Key Differences

- CJS uses `require()` and `module.exports`, ESM uses `import` and `export`
- CJS modules load synchronously, ESM modules load asynchronously
- CJS allows dynamic requires, ESM imports are static
- **ESM cannot be loaded with `require()`** - this is a hard limitation in Node.js

### The Challenge

The JavaScript ecosystem has 3 packages types

- **Legacy packages** use CommonJS (can be used in both CJS and ESM projects)
- **Modern packages** are ESM-only (newer versions of `chalk`, `inquirer`, `node-fetch`, etc.)
- **Hybrid packages** has duplicated bundle with CJS and ESM

Our monorepo needs to:

1. Work with all dependency types (CommonJS, ESM, and hybrid)
2. Use modern TypeScript features
3. Support both bundled (webpack, rollup) and unbundled Node.js code
4. Maintain consistent configuration across 16+ workspace packages

## How Our Configuration Solves This

### Core Settings Explained

See `libs/common-config/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["esnext"]
  }
}
```

#### `"target": "ES2021"`

- We require Node.js 24+, which fully supports ES2021 features
- Generates modern, performant code without unnecessary polyfills
- Supports async/await, Promise, optional chaining, nullish coalescing, etc.

#### `"module": "esnext"`

- Outputs modern ES modules (import/export syntax)
- Works with all modern bundlers (webpack, rollup, Next.js, vite)
- Allows importing both ESM and CommonJS dependencies
- Future-proof and most permissive

**Alternatives we rejected:**

- `"commonjs"` - Can't import ESM-only packages, creates runtime errors
- `"nodenext"` - Enforces strict Node.js ESM rules (requires file extensions), too strict for bundled code

#### `"moduleResolution": "bundler"`
- 
- **Most projects in this monorepo use bundlers** (webpack, rollup, Next.js)
- Understands package.json `"exports"` field (modern package entry points)
- Allows extensionless imports (bundlers resolve them)
- Properly resolves monorepo workspace dependencies
- More permissive than `"nodenext"` - doesn't require `.js` extensions in imports

**Alternatives we rejected:**
- `"node"` - Legacy algorithm, doesn't understand `"exports"`, causes type mismatches
- `"nodenext"` - Enforces strict file extension requirements, breaks bundler workflows

**Special case - Unbundled Node.js projects:**

For rare projects that run TypeScript output directly in Node.js without bundling, override with:
```json
{
  "extends": "@jitsu/common-config/tsconfig.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext"
  }
}
```
This enforces stricter Node.js ESM rules (but most projects don't need this).

#### `"lib": ["esnext"]`

- Provides latest JavaScript standard library types
- Server-side code doesn't need DOM types (`Document`, `Window`, etc.)
- Prevents accidental use of browser-only APIs in Node.js code

**Project-specific overrides:**

- **Browser/React projects:** Add `"dom"` and `"dom.iterable"` for browser APIs
- **Next.js apps:** Include `"dom"` since they run both server and client code

### Additional Settings

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "importHelpers": true,
    "skipLibCheck": true
  },
  "exclude": ["node_modules"]
}
```

- **`strict: true`:** Enable all strict type checking (catch more bugs)
- **`esModuleInterop: true`:** Allow `import foo from 'commonjs-module'` syntax
- **`resolveJsonModule: true`:** Allow importing .json files
- **`skipLibCheck: true`:** Skip type checking of .d.ts files for faster compilation
- **`exclude: ["node_modules"]`:** Only exclude node_modules by default; projects can extend this

**Note:** Project-specific settings like `outDir`, `rootDir`, and additional `exclude` patterns are intentionally omitted from the 
base config. Each project should define these based on its own directory structure.

## Usage

All workspace packages should extend this configuration:

```json
{
  "extends": "@jitsu/common-config/tsconfig.json",
  "compilerOptions": {
    // Project-specific overrides here
  }
}
```

## Common Overrides by Project Type

### Server Node.js projects (bundled)

Services and CLIs bundled with webpack:

```json
{
  "extends": "@jitsu/common-config/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
    // Inherits module: "esnext" and moduleResolution: "bundler"
  }
}
```

### Unbundled Node.js projects

Rare - projects that run tsc output directly in Node.js:

```json
{
  "extends": "@jitsu/common-config/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "nodenext",
    "moduleResolution": "nodenext"
  }
}
```

### Isomorphic libraries

For pure utility libraries that work in both environments without DOM dependencies:

```json
{
  "extends": "@jitsu/common-config/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
    // Inherits lib: ["esnext"] - no DOM types needed
  }
}
```

### Browser/React libraries

```json
{
  "extends": "@jitsu/common-config/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "lib": ["dom", "esnext"],
    "jsx": "react"
  }
}
```

### Bundled projects (webpack, rollup)

No module override needed:

```json
{
  "extends": "@jitsu/common-config/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist"
    // Inherits module: "esnext" and moduleResolution: "bundler"
  }
}
```

### Next.js apps

```json
{
  "extends": "@jitsu/common-config/tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "noEmit": true
  },
  "exclude": ["node_modules"]
}
```

## Related Resources

- [TypeScript Module Resolution](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
- [Node.js ECMAScript Modules](https://nodejs.org/api/esm.html)
- [TypeScript Compiler Options](https://www.typescriptlang.org/tsconfig)

## Workspace Projects Overview

> **Note:** This table may be outdated as projects are added, removed, or reconfigured. Verify configurations by checking individual
> `tsconfig.json` files.

| Category | Package | Location | Build Tool | Notes |
|----------|---------|----------|------------|-------|
| **Server Node.js (Bundled)** | `@jitsu-internal/profile-builder` | `services/profiles` | webpack | Bundled Node.js service |
| | `@jitsu-internal/rotor` | `services/rotor` | webpack | Bundled Node.js service |
| | `jitsu-cli` | `cli/jitsu-cli` | webpack | CLI tool |
| | `jitsu-build-scripts` | `cli/build-scripts` | webpack | Build scripts CLI |
| **Unbundled Node.js** | `@jitsu/core-functions` | `libs/core-functions` | tsc | Node.js library with `declaration: true` |
| **Next.js Apps** | `@jitsu-internal/console` | `webapps/console` | next | SSR + API routes, uses `lib: ["dom"]` |
| | `@jitsu-ee/ee-api` | `webapps/ee-api` | next | API routes app, uses `lib: ["dom"]` |
| **Browser/React Libraries** | `@jitsu/js` | `libs/jitsu-js` | rollup | Universal lib, uses `lib: ["dom"]`, outputs CJS + ESM |
| | `@jitsu/jitsu-react` | `libs/jitsu-react` | microbundle | React components, uses `lib: ["dom"]`, `jsx: react` |
| | `@jitsu/functions-lib` | `libs/functions` | rollup | Universal lib, uses `lib: ["dom"]`, outputs CJS + ESM |
| **Isomorphic Libraries** | `juava` | `libs/juava` | tsc | Pure utility lib, no DOM, works in Node.js + Browser |
| | `jsondiffpatch` | `libs/jsondiffpatch` | tsc | Isomorphic lib, `target: ES2015`, no DOM |
| | `@jitsu/protocols` | `types/protocols` | typecheck | Type definitions, environment-agnostic |
| **Shared/Config** | `@jitsu/common-config` | `libs/common-config` | — | Base TypeScript config (this package) |
| | `@jitsu-internal/webapps-shared` | `webapps/shared` | typecheck | Shared utilities, uses `lib: ["dom"]`, `jsx: preserve` |
| **Testing/Examples** | `@jitsu-internal/e2e` | `e2e` | jest | E2E test suite |
| | `@jitsu/react-example` | `examples/react-app` | react-scripts | Example React app (CRA) |
