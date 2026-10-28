# Rotor runtime dependencies

These packages stay outside the JavaScript bundle. `build.mts` reads this
manifest to choose the external modules, copies both manifests into `dist`, and
runs `npm ci --omit=dev` there. Native binaries are installed for the build
platform; dependency versions come from this lockfile.

To update a dependency, change its version in `package.json`, then regenerate
the lockfile from this directory without installing platform-specific binaries:

```sh
npm install --package-lock-only --ignore-scripts --workspaces=false
```

Commit both files and validate a clean `npm ci --omit=dev` on the target build
platform. Do not commit `node_modules`. The initial lockfile preserves the
installed dependency versions from rotor `2.15.0-beta.96`.
