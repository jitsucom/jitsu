import { describe, expect, it } from "vitest";
import { isLocalCliRedirect } from "../../lib/auth-redirect";

describe("isLocalCliRedirect", () => {
  it("accepts the local callback server of jitsu-cli", () => {
    expect(isLocalCliRedirect("http://localhost:1234/")).toBe(true);
    expect(isLocalCliRedirect("http://localhost:51234/callback")).toBe(true);
  });

  it("rejects a localhost url smuggled into the fragment or query of another host", () => {
    expect(isLocalCliRedirect("https://evil.example/#http://localhost:1234/")).toBe(false);
    expect(isLocalCliRedirect("https://evil.example/?next=http://localhost:1234/")).toBe(false);
    expect(isLocalCliRedirect("https://evil.example/http://localhost:1234/")).toBe(false);
  });

  it("rejects hosts that only start with localhost or carry credentials", () => {
    expect(isLocalCliRedirect("http://localhost:1234@evil.example/")).toBe(false);
    expect(isLocalCliRedirect("http://localhost.evil.example:1234/")).toBe(false);
    expect(isLocalCliRedirect("http://localhost:1234.evil.example/")).toBe(false);
  });

  it("rejects redirects that could change the target once a query is appended", () => {
    expect(isLocalCliRedirect("http://localhost:1234/#frag")).toBe(false);
    expect(isLocalCliRedirect("http://localhost:1234/?a=b")).toBe(false);
    expect(isLocalCliRedirect("http://localhost:1234/\\evil.example")).toBe(false);
  });

  it("rejects empty and non-http values", () => {
    expect(isLocalCliRedirect("")).toBe(false);
    expect(isLocalCliRedirect("https://localhost:1234/")).toBe(false);
    expect(isLocalCliRedirect("javascript:alert(1)")).toBe(false);
  });
});
