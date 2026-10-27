import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import * as esbuild from "esbuild";
import { compileUdfToFile, compileUdfToIIFE } from "../src/lib/udf-shared";

vi.mock("esbuild", async importOriginal => {
  const actual = await importOriginal<typeof esbuild>();
  return { ...actual, build: vi.fn(actual.build) };
});

let fixture: string;
beforeAll(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), "udf-import-security-"));
  await fs.writeFile(path.join(fixture, "secret.json"), JSON.stringify({ password: "other-tenant-secret" }));
  await fs.writeFile(path.join(fixture, "secret.json.gz"), gzipSync('{"password":"compressed-synthetic-secret"}'));
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
    it.each(["import", "require"])("rejects computed %s before esbuild can expand filesystem globs", async method => {
      const prefix = "./" + path.relative(process.cwd(), fixture) + "/";
      const expressions = [
        `${JSON.stringify(prefix)} + name + ".json"`,
        "`" + prefix + "${name}.json`",
        // Escapes and comments must be parsed, not checked with a source regex.
        `"\\x2e${prefix.slice(1)}" /* path */ + name + ".json"`,
        `(${JSON.stringify(prefix)} + (name) + ".json")`,
        "name",
      ];
      for (const expression of expressions) {
        vi.mocked(esbuild.build).mockClear();
        await expect(compile(`export default name => ${method}(${expression});`)).rejects.toThrow(
          "Computed imports are not allowed"
        );
        expect(esbuild.build).not.toHaveBeenCalled();
      }
    });

    it("still rejects filesystem paths when normalization turns a conditional into literal imports", async () => {
      const specifier = "./" + path.relative(process.cwd(), path.join(fixture, "secret.json"));
      for (const method of ["import", "require"]) {
        await expect(
          compile(`export default name => ${method}(name ? ${JSON.stringify(specifier)} : "node:crypto");`)
        ).rejects.toThrow("not allowed");
      }
    });

    it.each([
      "module.require",
      'module["require"]',
      'module["requ" + "ire"]',
      "module[`require`]",
      "module.require?.",
      "module?.require",
      "(true && module).require",
    ])("rejects CommonJS %s globs before bundling", async method => {
      const prefix = "./" + path.relative(process.cwd(), fixture) + "/";
      vi.mocked(esbuild.build).mockClear();
      await expect(
        compile(`module.exports = name => ${method}(${JSON.stringify(prefix)} + name + ".json");`)
      ).rejects.toThrow("Computed imports are not allowed");
      expect(esbuild.build).not.toHaveBeenCalled();
    });

    it("rejects computed compressed-byte imports before bundling", async () => {
      const prefix = "./" + path.relative(process.cwd(), fixture) + "/";
      vi.mocked(esbuild.build).mockClear();
      await expect(
        compile(
          `export default name => import(${JSON.stringify(prefix)} + name + ".json.gz", { with: { type: "bytes" } });`
        )
      ).rejects.toThrow("Computed imports are not allowed");
      expect(esbuild.build).not.toHaveBeenCalled();
    });

    it.each([
      'export default name => requ\\u0069re("./" + name + ".json");',
      'export default name => require?.("./" + name + ".json");',
      'export default name => require(...["./" + name + ".json"]);',
      'export default async name => { try { return await import("./" + name + ".json"); } catch { return null; } };',
      'export default () => require("node:crypto", import("./" + globalThis.name + ".json"));',
      'function decorate(x) { return x; } @decorate class Helper { load(name) { return import("./" + name + ".json"); } } export default name => new Helper().load(name);',
      'function decorate(x) { return x; } @decorate class Helper { load(name) { return require("./" + name + ".json"); } } export default name => new Helper().load(name);',
    ])("rejects nested and alternate computed import syntax: %s", async code => {
      vi.mocked(esbuild.build).mockClear();
      await expect(compile(code)).rejects.toThrow("Computed imports are not allowed");
      expect(esbuild.build).not.toHaveBeenCalled();
    });

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

    it.each([
      'import { createHash } from "crypto"; export default () => createHash("sha256");',
      'import { webcrypto } from "node:crypto"; export default () => webcrypto;',
      'export default () => import("node:crypto");',
      'export default () => require("crypto");',
      'module.exports = () => module.require("node:crypto");',
      "export default () => import(`node:crypto`);",
      'export default () => import("node:" + "crypto");',
      "export default () => require(`crypto`);",
      'export { RetryError as default } from "@jitsu/functions-lib";',
      '// import("./" + name)\nexport default () => "require(`./${name}.json`)";',
      'export default event => ({ ...event, value: event?.nested?.value ?? "default", amount: 1_000 });',
      "function decorate(x) { return x; } @decorate class Helper {} export default () => new Helper();",
    ])("preserves supported imports and ordinary JavaScript: %s", async code => {
      const result = await compile(code);
      expect(result).toBeTruthy();
      if (mode === "file") await fs.rm(result, { force: true });
    });
  });
}
