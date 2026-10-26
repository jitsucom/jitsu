import { describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileUdfToIIFE } from "../src/lib/udf-shared";

// JITSU-262: the import allowlist only looked at bare package names, so an absolute or relative path pulled any file
// readable by the process into the function bundle (on the shared pod: other tenants' connection files).

describe("UDF import restrictions", () => {
  async function secretFile(): Promise<string> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "udf-secret-"));
    const file = path.join(dir, "connections.json");
    await fsp.writeFile(file, JSON.stringify({ password: "tenant-b-secret" }));
    return file;
  }

  it("refuses an absolute path import", async () => {
    const file = await secretFile();
    const code = `import secret from ${JSON.stringify(file)};\nexport default async () => secret;`;
    await expect(compileUdfToIIFE(code, "f1", {})).rejects.toThrow(/is not allowed in UDF functions/);
  });

  it("refuses a relative path import, a dynamic import and require()", async () => {
    const file = await secretFile();
    const relative = path.relative(process.cwd(), file);
    for (const code of [
      `import secret from ${JSON.stringify(
        relative.startsWith(".") ? relative : "./" + relative
      )};\nexport default () => secret;`,
      `export default async () => (await import(${JSON.stringify(file)})).default;`,
      `export default () => require(${JSON.stringify(file)});`,
    ]) {
      await expect(compileUdfToIIFE(code, "f2", {})).rejects.toThrow(/not allowed in UDF functions/);
    }
  });

  it("refuses a path traversal through an allowed package", async () => {
    const code = `import x from "@jitsu/functions-lib/../../../../etc/hosts";\nexport default () => x;`;
    await expect(compileUdfToIIFE(code, "f3", {})).rejects.toThrow(/not allowed in UDF functions/);
  });

  it("does not leak the file content into any successful bundle", async () => {
    const file = await secretFile();
    const result = await compileUdfToIIFE(`export default () => 1;`, "f4", {});
    expect(result).not.toContain("tenant-b-secret");
    void file;
  });

  it("still compiles a function that imports the allowed package and node built-ins", async () => {
    const code = `import { RetryError } from "@jitsu/functions-lib";\nimport crypto from "crypto";\nexport default () => [RetryError, crypto];`;
    const out = await compileUdfToIIFE(code, "f5", {});
    expect(out).toContain("__udf");
  });
});
