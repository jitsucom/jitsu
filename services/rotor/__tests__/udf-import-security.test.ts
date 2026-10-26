import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileUdfToFile, compileUdfToIIFE } from "../src/lib/udf-shared";

let fixture: string;
beforeAll(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), "udf-import-security-"));
  await fs.writeFile(path.join(fixture, "secret.json"), JSON.stringify({ password: "other-tenant-secret" }));
});
afterAll(async () => {
  await fs.rm(fixture, { recursive: true, force: true });
});

for (const mode of ["file", "worker"] as const) {
  const compile = (code: string) =>
    mode === "worker"
      ? compileUdfToIIFE(code, "import-security", {})
      : compileUdfToFile("security", code, "import-security", {});
  describe(`${mode} UDF import boundary`, () => {
    it.each(["absolute", "relative", "file-url", "package-traversal", "builtin-subpath"])(
      "rejects %s imports before reading files",
      async kind => {
        const absolute = path.join(fixture, "secret.json");
        const specifier = {
          absolute,
          relative: "./" + path.relative(process.cwd(), absolute),
          "file-url": "file://" + absolute,
          "package-traversal": "@jitsu/functions-lib/../../../../secret.json",
          "builtin-subpath": "crypto/../../secret.json",
        }[kind]!;
        for (const code of [
          `import secret from ${JSON.stringify(specifier)}; export default () => secret;`,
          `export default () => require(${JSON.stringify(specifier)});`,
          `export default () => import(${JSON.stringify(specifier)});`,
        ]) {
          await expect(compile(code)).rejects.toThrow("not allowed");
        }
      }
    );
    it("keeps supported functions-lib imports", async () => {
      const result = await compile(
        'import { RetryError } from "@jitsu/functions-lib"; export default () => { throw new RetryError("retry"); };'
      );
      expect(result).toBeTruthy();
      if (mode === "file") await fs.rm(result, { force: true });
    });
  });
}
