# Third-party licenses

This project is distributed under the MIT License (see `LICENSE`). MIT requires that the upstream LICENSE text be preserved in each third-party dependency's installed artifact — npm and Go's module cache do this by default.


This file summarizes the third-party open-source components included in or linked from `jitsu` (generated from a CycloneDX SBOM of the dependency tree). The full per-package bill of materials is not committed to this repo to keep diffs reviewable; regenerate it with the script below.


## Summary by license category

| Category | Count |
|---|---:|
| Permissive | 1795 |
| Permissive (with attribution) | 616 |
| Weak copyleft | 21 |
| **Total third-party components** | **2432** |

## What each category means

**Permissive** — Licenses like MIT, BSD, ISC, 0BSD, Unlicense, CC0, Boost, etc. Allow use, modification, and redistribution with minimal restrictions. No source-disclosure or attribution-in-derivative-works requirement beyond preserving the upstream LICENSE text in the package itself.

**Permissive (with attribution)** — Licenses like Apache-2.0, Artistic, CC-BY. Allow use, modification, and redistribution like other permissive licenses, but additionally require preserving any upstream NOTICE file and crediting the original authors. Honored by keeping the LICENSE/NOTICE text in the installed package.

**Weak copyleft** — Licenses like MPL-2.0, LGPL, EPL, CDDL. File-level or library-level copyleft: modifications to the licensed files themselves must be released under the same license, but using the library as a dependency does not force the surrounding project to be open source. Safe for unmodified library use.


## Weak-copyleft dependencies (explicit list)

These are the entries a license-compliance reviewer needs to confirm. All are safe as unmodified library deps; none would force this project to be relicensed.


| Package | Version | Ecosystem | License(s) |
|---|---|---|---|
| `github.com/go-sql-driver/mysql` | v1.9.3 | golang | MPL-2.0 |
| `github.com/hashicorp/errwrap` | v1.1.0 | golang | MPL-2.0 |
| `github.com/hashicorp/go-cleanhttp` | v0.5.2 | golang | MPL-2.0 |
| `github.com/hashicorp/go-multierror` | v1.1.1 | golang | MPL-2.0 |
| `github.com/hashicorp/go-version` | v1.9.0 | golang | MPL-2.0 |
| `@img/sharp-libvips-darwin-arm64` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-libvips-darwin-x64` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm64` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-ppc64` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-riscv64` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-s390x` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-x64` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-x64` | 1.2.4 | npm | LGPL-3.0-or-later |
| `@img/sharp-wasm32` | 0.34.5 | npm | Apache-2.0 AND LGPL-3.0-or-later AND MIT |
| `@img/sharp-win32-arm64` | 0.34.5 | npm | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-ia32` | 0.34.5 | npm | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-x64` | 0.34.5 | npm | Apache-2.0 AND LGPL-3.0-or-later |
| `axe-core` | 4.10.2 | npm | MPL-2.0 |
| `ip6addr` | 0.2.5 | npm | MPL-2.0 |

## Permissive dependencies

There are 2411 permissive third-party components. They are not enumerated here to keep this file readable. Each is honored by preserving the upstream LICENSE/NOTICE text in the installed package.

Full attribution is available by:

- Running `syft <repo>/. -o cyclonedx-json` to regenerate the SBOM, or
- Inspecting `node_modules/**/LICENSE` (npm/bun) or `$GOPATH/pkg/mod/.../LICENSE` (Go) in an installed checkout.


## Regenerating this file

This file is auto-generated. To regenerate from the current dep tree:

```bash
# 1. Install dependencies so package metadata is available.
pnpm install
# (Go deps resolve via GOPROXY automatically when syft runs.)

# 2. Generate a CycloneDX SBOM with license enrichment.
SYFT_ENRICH=all \
  SYFT_GOLANG_SEARCH_REMOTE_LICENSES=true \
  SYFT_JAVASCRIPT_SEARCH_REMOTE_LICENSES=true \
  syft . -o cyclonedx-json=sbom.cdx.json
```

The SBOM is the canonical source of truth; this file is a human-readable summary derived from it.
