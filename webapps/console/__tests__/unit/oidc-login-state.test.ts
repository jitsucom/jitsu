import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest } from "next";
import {
  canonicalAuthorizeLocation,
  clearLoginBindingCookie,
  hashLoginBinding,
  isValidLoginAttempt,
  loginBindingCookie,
  loginBindingCookieName,
  loginBindingMatches,
  newLoginBinding,
  oidcBaseUrl,
} from "../../lib/server/oidc-login-state";

afterEach(() => vi.unstubAllEnvs());

/** A request as far as these helpers look at it */
const request = (
  headers: Record<string, string> = {},
  url = "/api/auth/dynamic-oidc/authorize?providerId=p1",
  query: Record<string, string> = { providerId: "p1" }
) => ({ headers, url, query } as unknown as NextApiRequest);
const configure = (nextauth: string, publicUrl = "") => {
  vi.stubEnv("NEXTAUTH_URL", nextauth);
  vi.stubEnv("JITSU_PUBLIC_URL", publicUrl);
};

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

describe("the attempt id of a login", () => {
  it("is different for every login and is accepted by the check that guards the cookie name", () => {
    const a = newLoginBinding();
    const b = newLoginBinding();
    expect(a.attempt).not.toBe(b.attempt);
    expect(isValidLoginAttempt(a.attempt)).toBe(true);
    expect(a.attempt).not.toBe(a.value);
  });

  it.each([
    "",
    "short",
    "a;path=/",
    "../../x",
    "has space ok",
    "x".repeat(33),
    "tab\tbed-attempt",
    42,
    null,
    undefined,
    {},
    ["abcdefgh"],
  ])("refuses %j", odd => {
    expect(isValidLoginAttempt(odd)).toBe(false);
  });
});

describe("the base URL of the login", () => {
  it("is the configured one: NEXTAUTH_URL before JITSU_PUBLIC_URL, whatever the request says", () => {
    configure("https://a.example", "https://b.example");
    expect(oidcBaseUrl(request({ host: "other:3000", "x-forwarded-proto": "http" }))).toBe("https://a.example");
    configure("", "https://b.example");
    expect(oidcBaseUrl(request({ host: "other:3000" }))).toBe("https://b.example");
  });

  it.each([
    ["x-forwarded-proto", { "x-forwarded-proto": "https", host: "h.example" }, "https://h.example"],
    ["x-forwarded-protocol", { "x-forwarded-protocol": "https", host: "h.example" }, "https://h.example"],
    ["the first of a list", { "x-forwarded-proto": "https, http", host: "h.example" }, "https://h.example"],
    ["nothing forwarded", { host: "h.example:3000" }, "http://h.example:3000"],
  ])("derives it from the request when nothing is configured: %s", (_name, headers, expected) => {
    configure("");
    expect(oidcBaseUrl(request(headers))).toBe(expected);
  });
});

describe("the binding cookie", () => {
  const parse = (setCookie: string) => {
    const [pair, ...attrs] = setCookie.split(";").map(x => x.trim());
    return { name: pair.split("=")[0], attrs: attrs.map(a => a.toLowerCase()) };
  };

  it("over an https base is a __Host- cookie: Secure, Path=/, no Domain", () => {
    configure("https://console.example");
    const c = parse(loginBindingCookie(request({ host: "console.example" }), "attempt12345", "value"));
    expect(c.name).toBe("__Host-oidc-login-state-attempt12345");
    expect(c.attrs).toContain("secure");
    expect(c.attrs).toContain("path=/");
    expect(c.attrs.some(a => a.startsWith("domain"))).toBe(false);
    expect(c.attrs).toContain("httponly");
    expect(c.attrs).toContain("samesite=lax");
  });

  it("over an http base has the plain name, the narrow path and no Secure", () => {
    configure("http://localhost:3000");
    const c = parse(
      loginBindingCookie(request({ host: "localhost:3000", "x-forwarded-proto": "https" }), "attempt12345", "value")
    );
    expect(c.name).toBe("oidc-login-state-attempt12345");
    expect(c.attrs).toContain("path=/api/auth/dynamic-oidc");
    expect(c.attrs).not.toContain("secure");
  });

  it("is cleared under the same name and path it was set with", () => {
    for (const base of ["https://console.example", "http://localhost:3000"]) {
      configure(base);
      const req = request({ host: new URL(base).host });
      const set = parse(loginBindingCookie(req, "attempt12345", "value"));
      const cleared = parse(clearLoginBindingCookie(req, "attempt12345"));
      expect(cleared.name).toBe(set.name);
      expect(cleared.name).toBe(loginBindingCookieName(req, "attempt12345"));
      expect(cleared.attrs).toContain("max-age=0");
      expect(cleared.attrs.filter(a => a.startsWith("path="))).toEqual(set.attrs.filter(a => a.startsWith("path=")));
    }
  });

  it("has a different name for every attempt", () => {
    configure("https://console.example");
    const req = request({ host: "console.example" });
    expect(loginBindingCookieName(req, "attempt11111")).not.toBe(loginBindingCookieName(req, "attempt22222"));
  });
});

describe("the host the login starts on", () => {
  it("is left alone when the request is on the configured host, whatever the case or the list", () => {
    configure("https://Console.Example");
    expect(canonicalAuthorizeLocation(request({ host: "console.example" }))).toBeUndefined();
    expect(
      canonicalAuthorizeLocation(request({ host: "internal:3000", "x-forwarded-host": "console.example, proxy" }))
    ).toBeUndefined();
  });

  it("sends a request on another host to the configured one, with the path, the query and the marker", () => {
    configure("https://console.example");
    const to = canonicalAuthorizeLocation(
      request({ host: "alias.example" }, "/api/auth/dynamic-oidc/authorize?providerId=p1&callbackUrl=%2Fws1")
    );
    expect(new URL(to!).origin).toBe("https://console.example");
    expect(new URL(to!).pathname).toBe("/api/auth/dynamic-oidc/authorize");
    expect(new URL(to!).searchParams.get("providerId")).toBe("p1");
    expect(new URL(to!).searchParams.get("callbackUrl")).toBe("/ws1");
    expect(new URL(to!).searchParams.get("_canonical")).toBe("1");
  });

  it("treats a different port as a different host", () => {
    configure("http://localhost:3000");
    expect(canonicalAuthorizeLocation(request({ host: "localhost:3300" }))).toContain("http://localhost:3000/");
  });

  it("sends a request only once", () => {
    configure("https://console.example");
    expect(
      canonicalAuthorizeLocation(request({ host: "alias.example" }, "/x?_canonical=1", { _canonical: "1" }))
    ).toBeUndefined();
  });

  it.each(["//evil.example/x", "/\\evil.example", "http://evil.example/x", "///evil.example", "/%2F%2Fevil.example"])(
    "never takes a host from the request URL: %s",
    url => {
      configure("https://console.example");
      const to = canonicalAuthorizeLocation(request({ host: "evil.example" }, url));
      expect(new URL(to!).origin).toBe("https://console.example");
    }
  );

  it("does nothing when the configured base is not a URL, or the request names no host", () => {
    configure("not a url");
    expect(canonicalAuthorizeLocation(request({ host: "alias.example" }))).toBeUndefined();
    configure("https://console.example");
    expect(canonicalAuthorizeLocation(request({}))).toBeUndefined();
  });
});
