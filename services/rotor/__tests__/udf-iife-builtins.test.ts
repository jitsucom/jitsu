import { describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
import { compileUdfToIIFE } from "../src/lib/udf-shared";
import { evaluateUdfIife, makeUdfRequire } from "../src/lib/udf-require";

// JITSU-263: the worker evaluates a UDF compiled to an IIFE with `new Function(iife + "\nreturn __udf;")`. esbuild turns a
// static import of a Node built-in into a `require` call, and a worker has no `require`, so the function was replaced by
// one that throws, while the in-process build runs it.

const udf = (specifier: string) => `import { createHash } from "${specifier}";
export default async function (event) {
  event.hash = createHash("sha256").update("abc").digest("hex").slice(0, 8);
  return event;
}`;

describe("a UDF with a static import of crypto, evaluated like the worker does", () => {
  it.each(["crypto", "node:crypto"])("compiles and evaluates for %s", async specifier => {
    const iife = await compileUdfToIIFE(udf(specifier), "f1", {});
    // the call the worker makes: no `require` of its own, only the one it hands over
    const mod = evaluateUdfIife(iife, makeUdfRequire({ crypto }));
    const out = await mod.default({});
    expect(out.hash).toBe("ba7816bf");
  });

  it("still refuses a module the worker does not serve", async () => {
    const iife = await compileUdfToIIFE(udf("crypto"), "f1", {});
    expect(() => evaluateUdfIife(iife, makeUdfRequire({}))).toThrow(
      'Dynamic require of "node:crypto" is not supported'
    );
  });
});

describe("the require handed to a UDF", () => {
  const req = makeUdfRequire({ crypto });
  it("serves a preloaded built-in under both spellings", () => {
    expect(req("crypto")).toBe(crypto);
    expect(req("node:crypto")).toBe(crypto);
  });
  it("throws for anything else, including names that exist on every object", () => {
    for (const name of ["fs", "node:fs", "child_process", "__proto__", "constructor", "toString"]) {
      expect(() => req(name)).toThrow("is not supported");
    }
  });
});
