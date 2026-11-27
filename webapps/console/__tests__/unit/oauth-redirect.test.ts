import { describe, expect, it } from "vitest";
import { describeRedirect } from "../../lib/shared/oauth-redirect";

describe("describeRedirect", () => {
  it.each([
    "http://localhost:6274/oauth/callback",
    "http://127.0.0.1:33333/cb",
    "http://[::1]:8080/cb",
    // the whole 127.0.0.0/8 block is loopback, not only 127.0.0.1
    "http://127.0.0.2:8080/cb",
    "http://127.255.255.254/cb",
    // the URL parser turns short and numeric forms into 127.x.x.x
    "http://127.1:9000/cb",
    "http://2130706433/cb",
  ])("treats %s as local", uri => {
    expect(describeRedirect(uri)?.isLocal).toBe(true);
  });

  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://evil.example/callback",
    "https://localhost.evil.example/cb",
    "http://127.0.0.1.evil.example/cb",
    "http://127.0.0.2.evil.example/cb",
    "http://128.0.0.1/cb",
    "http://126.255.255.255/cb",
    "http://10.0.0.1/cb",
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
