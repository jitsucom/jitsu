import { describe, expect, it, vi } from "vitest";
import { getEeConnection, getEeServerConnection, isEEAvailable } from "../../lib/server/ee";

describe("billing connection URLs", () => {
  it("keeps the browser URL public when server calls use cluster DNS", () => {
    vi.stubEnv("EE_CONNECTION", "https://billing.example.com");
    vi.stubEnv("EE_CONNECTION_INTERNAL", "http://billing.newjitsu.svc.cluster.local");
    expect(getEeConnection().host).toBe("https://billing.example.com/");
    expect(getEeServerConnection().host).toBe("http://billing.newjitsu.svc.cluster.local/");
  });

  it.each([undefined, ""])("falls back to the public URL when internal URL is %s", internal => {
    vi.stubEnv("EE_CONNECTION", "https://billing.example.com/base");
    vi.stubEnv("EE_CONNECTION_INTERNAL", internal);
    expect(getEeServerConnection()).toEqual(getEeConnection());
    expect(getEeServerConnection().host).toBe("https://billing.example.com/base/");
  });

  it("expands templates and strips legacy queries and fragments from both URLs", () => {
    vi.stubEnv("JITSU_BRANCH_SUFFIX", "-pr190");
    vi.stubEnv("EE_CONNECTION", "https://ee${JITSU_BRANCH_SUFFIX}.jitsu.localhost/base?jwtSecret=old#fragment");
    vi.stubEnv("EE_CONNECTION_INTERNAL", "http://billing${JITSU_BRANCH_SUFFIX}/base///?legacy=value#fragment");
    expect(getEeConnection().host).toBe("https://ee-pr190.jitsu.localhost/base/");
    expect(getEeServerConnection().host).toBe("http://billing-pr190/base/");
  });

  it("does not silently fall back when the internal URL is invalid", () => {
    vi.stubEnv("EE_CONNECTION", "https://billing.example.com/");
    vi.stubEnv("EE_CONNECTION_INTERNAL", "not a URL");
    expect(() => getEeServerConnection()).toThrow();
    expect(getEeConnection().host).toBe("https://billing.example.com/");
  });

  it("rejects unresolved templates", () => {
    vi.stubEnv("EE_CONNECTION", "https://billing.example.com/");
    vi.stubEnv("EE_CONNECTION_INTERNAL", "http://billing${JITSU_BRANCH_SUFFIX}/");
    vi.stubEnv("JITSU_BRANCH_SUFFIX", undefined);
    expect(() => getEeServerConnection()).toThrow("unset variable");
  });

  it("does not enable EE with only an internal URL", () => {
    vi.stubEnv("EE_CONNECTION", undefined);
    vi.stubEnv("EE_CONNECTION_INTERNAL", "http://billing.internal/");
    expect(isEEAvailable()).toBe(false);
    expect(() => getEeConnection()).toThrow("EE is not available");
    expect(() => getEeServerConnection()).toThrow("EE is not available");
  });
});
