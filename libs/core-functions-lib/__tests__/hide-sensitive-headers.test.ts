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

  it("tolerates missing and malformed headers", async () => {
    const { hideSensitiveHeaders } = await import("../src/functions/lib/index");
    expect(hideSensitiveHeaders(undefined)).toEqual({});
    expect(hideSensitiveHeaders(null)).toEqual({});
    expect(hideSensitiveHeaders([["only-a-name"], "junk", null])).toEqual({});
  });
});
