import { describe, expect, it } from "vitest";
import { RetryError, RetryErrorName } from "@jitsu/functions-lib";
import { compileFailureIife, retryErrorOf } from "../src/lib/udf-placeholder";
import { evaluateUdfIife, makeUdfRequire } from "../src/lib/udf-require";

// JITSU-263: in process a UDF that fails to compile is replaced by a function that throws a RetryError; the isolated worker
// threw a plain Error, so the failed transformation lost its retries.

describe("the function that replaces a UDF which failed to compile or load", () => {
  it("throws a RetryError in a worker, as it does in process", async () => {
    const mod = evaluateUdfIife(
      compileFailureIife('Failed to compile function f1:\n"x" is not defined'),
      makeUdfRequire({})
    );
    const err: any = await mod.default({}).then(
      () => undefined,
      e => e
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe(RetryErrorName);
    expect(err.message).toBe('Failed to compile function f1:\n"x" is not defined');
    // the same name and message as the in-process placeholder (a real RetryError)
    const inProcess = new RetryError(err.message);
    expect(err.name).toBe(inProcess.name);
    expect(err.message).toBe(inProcess.message);
  });

  it("is the same error when the worker cannot load the compiled code", () => {
    const err = retryErrorOf("UDF f1: default export is not a function (got object)");
    expect(err.name).toBe(RetryErrorName);
    expect(err.message).toBe("UDF f1: default export is not a function (got object)");
  });
});
