import { describe, expect, it } from "vitest";

// The request headers of a UDF's fetch are logged with the credentials hidden. fetch accepts the headers as an object, a
// Headers or Map, or an array of [name, value] pairs; Object.entries of an array gave the keys "0", "1" and missed the name,
// so a bearer token passed as a pair was logged as it was. services/rotor/src/lib/worker-fetch.ts has the same rule for
// the sandboxed workers and its own test.
describe("hideSensitiveHeaders", () => {
  const pairs: [string, string][] = [
    ["Authorization", "Bearer secret"],
    ["X-Api-Token", "secret-2"],
    ["X-Trace", "t1"],
  ];
  const expected = { Authorization: "*****", "X-Api-Token": "*****", "X-Trace": "t1" };

  it("hides the sensitive headers whatever form they were passed in", async () => {
    const { hideSensitiveHeaders } = await import("../src/functions/lib/index");
    expect(hideSensitiveHeaders(Object.fromEntries(pairs))).toEqual(expected);
    expect(hideSensitiveHeaders(pairs)).toEqual(expected);
    expect(hideSensitiveHeaders(new Map(pairs))).toEqual(expected);
    expect(hideSensitiveHeaders(new Headers(pairs))).toEqual({
      authorization: "*****",
      "x-api-token": "*****",
      "x-trace": "t1",
    });
    expect(JSON.stringify(hideSensitiveHeaders(pairs))).not.toContain("secret");
  });

  // Set.prototype.forEach calls back with (value, value): a Set of pairs gave the whole pair as the name.
  it("hides the sensitive headers of a Set of pairs, and any other iterable of pairs", async () => {
    const { hideSensitiveHeaders } = await import("../src/functions/lib/index");
    expect(hideSensitiveHeaders(new Set(pairs))).toEqual(expected);
    expect(hideSensitiveHeaders(pairs.values())).toEqual(expected);
    expect(JSON.stringify(hideSensitiveHeaders(new Set(pairs)))).not.toContain("secret");
  });

  // Headers used to log nothing (Object.entries of a Headers is empty); iterating it exposes a Cookie, which the mask missed.
  it("hides cookies, in a Headers as in an object", async () => {
    const { hideSensitiveHeaders } = await import("../src/functions/lib/index");
    expect(hideSensitiveHeaders(new Headers({ Cookie: "sid=secret", "X-Trace": "t1" }))).toEqual({
      cookie: "*****",
      "x-trace": "t1",
    });
    expect(hideSensitiveHeaders({ Cookie: "sid=secret", "Set-Cookie": "a=b", "X-Trace": "t1" })).toEqual({
      Cookie: "*****",
      "Set-Cookie": "*****",
      "X-Trace": "t1",
    });
  });

  // fetch accepts any iterable of two-item iterables, a Set of two items included
  it("reads pairs that are not arrays", async () => {
    const { hideSensitiveHeaders } = await import("../src/functions/lib/index");
    const pairs = [new Set(["Authorization", "Bearer secret"]), new Set(["X-Trace", "t1"])];
    expect(hideSensitiveHeaders(pairs)).toEqual({ Authorization: "*****", "X-Trace": "t1" });
  });

  it("tolerates missing and malformed headers", async () => {
    const { hideSensitiveHeaders } = await import("../src/functions/lib/index");
    expect(hideSensitiveHeaders(undefined)).toEqual({});
    expect(hideSensitiveHeaders(null)).toEqual({});
    expect(hideSensitiveHeaders([["only-a-name"], "junk", null])).toEqual({});
  });
});

// makeFetch logs the redacted headers and then sends the original init. A generator of pairs can be read once, so the log
// used it up and the request left without its headers.
describe("reusableHeadersInit", () => {
  it("turns a one-shot iterable of header pairs into an array, and leaves other inits alone", async () => {
    const { reusableHeadersInit, hideSensitiveHeaders } = await import("../src/functions/lib/index");
    const gen = (function* () {
      yield ["Authorization", "Bearer secret"];
      yield ["X-Trace", "t1"];
    })();
    const init = reusableHeadersInit({ method: "POST", headers: gen });
    expect(hideSensitiveHeaders(init!.headers)).toEqual({ Authorization: "*****", "X-Trace": "t1" });
    expect(init!.headers).toEqual([
      ["Authorization", "Bearer secret"],
      ["X-Trace", "t1"],
    ]);
    expect(init!.method).toBe("POST");
    const headers = new Headers({ a: "b" });
    const withHeaders = { headers };
    expect(reusableHeadersInit(withHeaders)!.headers).toBe(headers);
    const plain = { headers: { a: "b" } };
    expect(reusableHeadersInit(plain)).toBe(plain);
    expect(reusableHeadersInit(undefined)).toBeUndefined();
  });
});
