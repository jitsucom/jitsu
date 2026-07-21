import { describe, expect, it } from "vitest";
import type { NextApiRequest } from "next";
import { extractRequestProvenance } from "../../lib/server/origin";
import { originFromAuth } from "../../lib/schema";

// The fragile, non-obvious rule: an X-Jitsu-Client "jitsu-cli/…" header overrides
// the token-based origin (recovering CLI provenance from a plain API key),
// case-insensitively, and ONLY for a jitsu-cli value — anything else falls
// through to the existing authType/token logic. The read-API SQL filter mirrors
// this precedence, so this is the shared contract both sides must agree on.
describe("originFromAuth — X-Jitsu-Client precedence", () => {
  const apiKey = { authType: "bearer", tokenId: "PpdX1lrYXvqFTFocW1xYLcX9UPbkTvxv" };
  it.each([
    ["plain API key, no header → api", apiKey, undefined, "api"],
    ["API key + jitsu-cli header → cli", apiKey, "jitsu-cli/0.9.1", "cli"],
    ["header match is case-insensitive", apiKey, "JITSU-CLI/1.0.0", "cli"],
    ["unrelated client falls through to token → api", apiKey, "some-tool/1.0", "api"],
    ["header wins over authType (mcp) → cli", { authType: "mcp" }, "jitsu-cli/1.0.0", "cli"],
  ] as const)("%s", (_label, auth, client, expected) => {
    expect(originFromAuth({ ...auth, headers: client ? { "x-jitsu-client": client } : null })).toBe(expected);
  });
});

// IP resolution is delegated to the existing getClientIp; the only new logic is
// the header allowlist, which must never persist credential-bearing headers.
describe("extractRequestProvenance", () => {
  it("keeps allowlisted headers and drops credentials", () => {
    const { ip, headers } = extractRequestProvenance({
      headers: { "x-jitsu-client": "jitsu-cli/9", authorization: "Bearer s", cookie: "a=b" },
      socket: { remoteAddress: "192.0.2.9" },
    } as unknown as NextApiRequest);
    expect(ip).toBe("192.0.2.9");
    expect(headers).toEqual({ "x-jitsu-client": "jitsu-cli/9" });
  });
});
