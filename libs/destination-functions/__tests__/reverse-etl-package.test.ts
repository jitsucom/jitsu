import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

it("includes the Reverse ETL entry points and their runtime modules in the npm package", async () => {
  const cache = await mkdtemp(join(tmpdir(), "jitsu-retl-pack-"));
  try {
    // Inspect the real package allowlist without running lifecycle scripts,
    // contacting the registry, or creating a tarball in the working tree.
    const { stdout } = await exec(
      "npm",
      ["pack", "--dry-run", "--ignore-scripts", "--offline", "--json", "--cache", cache],
      { cwd: fileURLToPath(new URL("../", import.meta.url)), timeout: 20_000 }
    );
    const [packed] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = packed.files.map(file => file.path);
    expect(files).toEqual(
      expect.arrayContaining([
        "src/index.ts",
        "src/meta.ts",
        "src/reverse-etl/index.ts",
        "src/reverse-etl/meta.ts",
        "src/reverse-etl/run.ts",
        "src/reverse-etl/identity.ts",
        "src/reverse-etl/README.md",
        "src/reverse-etl/catalog.ts",
        "src/reverse-etl/runtime.ts",
        "src/functions/google-ads/meta.ts",
        "src/functions/google-ads/runtime.ts",
        "src/functions/google-ads/credentials.ts",
        "src/functions/google-ads/audience/runtime.ts",
        "src/functions/google-ads/audience/meta.ts",
        "src/functions/google-ads/audience/state.ts",
        "src/functions/google-ads/audience/management.ts",
        "src/functions/google-ads/audience/provisioning.ts",
        "src/functions/google-ads/audience/editor.ts",
        "src/functions/google-ads/conversions/runtime.ts",
        "src/functions/google-ads/conversions/meta.ts",
        "src/functions/google-ads/conversions/editor.ts",
        "src/functions/google-ads/shared/identifiers.ts",
        "src/functions/google-ads/clients/data-manager.ts",
        "src/functions/google-ads/clients/google-ads.ts",
        "src/functions/google-ads/REVERSE_ETL.md",
      ])
    );
    expect(files.some(file => file.startsWith("__tests__/"))).toBe(false);
    expect(files.some(file => file.startsWith("src/functions/google-ads-reverse/"))).toBe(false);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}, 30_000);
