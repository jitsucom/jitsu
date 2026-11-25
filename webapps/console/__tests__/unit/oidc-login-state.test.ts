import { describe, expect, it } from "vitest";
import { hashLoginBinding, loginBindingMatches, newLoginBinding } from "../../lib/server/oidc-login-state";

describe("oidc login binding", () => {
  it("matches the cookie value that the hash was made from", () => {
    const b = newLoginBinding();
    expect(b.hash).toBe(hashLoginBinding(b.value));
    expect(loginBindingMatches(b.value, b.hash)).toBe(true);
  });

  it("gives a different secret each time and keeps the secret out of the hash", () => {
    const a = newLoginBinding();
    const b = newLoginBinding();
    expect(a.value).not.toBe(b.value);
    expect(a.value.length).toBeGreaterThanOrEqual(43);
    expect(a.hash).not.toContain(a.value);
    expect(loginBindingMatches(a.value, b.hash)).toBe(false);
  });

  it.each([
    ["a missing cookie", undefined],
    ["an empty cookie", ""],
    ["a non-string cookie", 42],
    ["an array cookie", ["a", "b"]],
    ["another value", "not-the-value"],
  ])("does not match %s", (_name, cookie) => {
    expect(loginBindingMatches(cookie, newLoginBinding().hash)).toBe(false);
  });

  it.each([
    ["a missing hash", undefined],
    ["an empty hash", ""],
    ["a non-string hash", {}],
    ["a hash of another length", "abc"],
  ])("does not match %s, even for a present cookie", (_name, hash) => {
    expect(loginBindingMatches(newLoginBinding().value, hash)).toBe(false);
  });

  it("does not match an empty cookie even against the hash of the empty string", () => {
    expect(loginBindingMatches("", hashLoginBinding(""))).toBe(false);
  });
});
