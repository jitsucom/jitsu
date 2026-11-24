import { describe, expect, it } from "vitest";
import { RetryError, RetryErrorName } from "@jitsu/functions-lib";
import { compileFailureIife, errorMessageOf, invalidFunctionsReason, retryErrorOf } from "../src/lib/udf-placeholder";
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

// The in-process runtime builds each connection's chain inside its own try/catch, so a connection with a malformed
// `functions` option fails alone. The isolated startup read the option without one, and a single bad connection stopped the
// whole server before it listened.
describe("the functions option of a connection", () => {
  it("is accepted when absent, empty or a list of entries with a string functionId", () => {
    expect(invalidFunctionsReason(undefined)).toBeUndefined();
    expect(invalidFunctionsReason({})).toBeUndefined();
    expect(invalidFunctionsReason({ functions: null })).toBeUndefined();
    expect(invalidFunctionsReason({ functions: [] })).toBeUndefined();
    expect(
      invalidFunctionsReason({ functions: [{ functionId: "udf.a" }, { functionId: "builtin.x", functionOptions: {} }] })
    ).toBeUndefined();
  });

  it("is refused, with a reason, when it is not a list or an entry has no string functionId", () => {
    expect(invalidFunctionsReason({ functions: "udf.a" })).toMatch(/functions/);
    expect(invalidFunctionsReason({ functions: { functionId: "udf.a" } })).toMatch(/functions/);
    expect(invalidFunctionsReason({ functions: [{ functionId: "udf.a" }, {}] })).toMatch(/functionId/);
    expect(invalidFunctionsReason({ functions: [null] })).toMatch(/functionId/);
    expect(invalidFunctionsReason({ functions: [{ functionId: 5 }] })).toMatch(/functionId/);
  });
});

// A UDF may throw anything while its module initializes. Reading `.message` of null or undefined threw inside the worker's
// catch, before the worker could answer "ready".
describe("the message of what a UDF threw", () => {
  it("is the message of an error, the text of a string, and a description of anything else", () => {
    expect(errorMessageOf(new Error("boom"))).toBe("boom");
    expect(errorMessageOf(new TypeError("bad"))).toBe("bad");
    expect(errorMessageOf("plain text")).toBe("plain text");
    expect(errorMessageOf(null)).toBe("null");
    expect(errorMessageOf(undefined)).toBe("undefined");
    expect(errorMessageOf(42)).toBe("42");
    expect(errorMessageOf({ code: 1 })).toBe("[object Object]");
    // an object without a prototype cannot be turned into a string: the message must still come out
    expect(() => errorMessageOf(Object.create(null))).not.toThrow();
    expect(errorMessageOf(Object.create(null))).toEqual(expect.any(String));
    expect(
      errorMessageOf({
        get message() {
          throw new Error("getter");
        },
      })
    ).toEqual(expect.any(String));
  });
});
