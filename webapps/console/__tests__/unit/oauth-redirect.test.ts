import { describe, expect, it } from "vitest";
import { describeRedirect } from "../../lib/shared/oauth-redirect";

describe("describeRedirect", () => {
  it.each(["http://localhost:6274/oauth/callback", "http://127.0.0.1:33333/cb", "http://[::1]:8080/cb"])(
    "treats %s as local",
    uri => {
      expect(describeRedirect(uri)?.isLocal).toBe(true);
    }
  );

  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://evil.example/callback",
    "https://localhost.evil.example/cb",
    "http://127.0.0.1.evil.example/cb",
  ])("treats %s as remote and names its host", uri => {
    const r = describeRedirect(uri)!;
    expect(r.isLocal).toBe(false);
    expect(r.host).toBe(new URL(uri).hostname);
  });

  it("returns nothing for missing or malformed uris", () => {
    expect(describeRedirect(undefined)).toBeUndefined();
    expect(describeRedirect("not a url")).toBeUndefined();
  });
});
