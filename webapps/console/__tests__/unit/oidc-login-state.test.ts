import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest } from "next";
import {
  canonicalAuthorizeLocation,
  clearLoginBindingCookie,
  clearStaleLoginBindingCookies,
  MAX_PENDING_LOGIN_BINDINGS,
  hashLoginBinding,
  isValidLoginAttempt,
  loginBindingCookie,
  loginBindingCookieName,
  loginBindingMatches,
  newLoginBinding,
  oidcBaseUrl,
  requestScheme,
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
    const https = { "x-forwarded-proto": "https" };
    expect(canonicalAuthorizeLocation(request({ host: "console.example", ...https }))).toBeUndefined();
    expect(
      canonicalAuthorizeLocation(
        request({ host: "internal:3000", "x-forwarded-host": "console.example, proxy", ...https })
      )
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

describe("the scheme a login starts on", () => {
  it("sends a request that came in over plain http to the https public URL, once", () => {
    configure("https://console.example");
    const to = canonicalAuthorizeLocation(request({ host: "console.example", "x-forwarded-proto": "http" }));
    expect(new URL(to!).origin).toBe("https://console.example");
    expect(new URL(to!).searchParams.get("_canonical")).toBe("1");
    expect(
      canonicalAuthorizeLocation(
        request({ host: "console.example", "x-forwarded-proto": "http" }, "/x?_canonical=1", { _canonical: "1" })
      )
    ).toBeUndefined();
  });

  it.each([
    ["https from x-forwarded-proto", { "x-forwarded-proto": "https" }],
    ["https from x-forwarded-protocol", { "x-forwarded-protocol": "https" }],
    ["a list that starts with https", { "x-forwarded-proto": "https, http" }],
    ["https twice", { "x-forwarded-proto": "https", "x-forwarded-protocol": "HTTPS" }],
  ])("leaves a request alone on the right host when the proxy positively says https: %s", (_name, headers) => {
    configure("https://console.example");
    expect(canonicalAuthorizeLocation(request({ host: "console.example", ...headers }))).toBeUndefined();
  });

  it.each([
    ["nothing forwarded", {}],
    ["plain http", { "x-forwarded-proto": "http" }],
    ["a protocol version", { "x-forwarded-proto": "HTTP/1.1" }],
    [
      "http next to https (Next.js fills in http, or an ingress says http)",
      { "x-forwarded-proto": "http", "x-forwarded-protocol": "https" },
    ],
    ["https next to http", { "x-forwarded-proto": "https", "x-forwarded-protocol": "http" }],
    ["a list that starts with http", { "x-forwarded-proto": "http, https" }],
  ])("sends a request to the https address when it is not positively https: %s", (_name, headers) => {
    configure("https://console.example");
    const to = canonicalAuthorizeLocation(request({ host: "console.example", ...headers }));
    expect(new URL(to!).origin).toBe("https://console.example");
    expect(new URL(to!).searchParams.get("_canonical")).toBe("1");
  });

  it("counts a TLS connection of the server itself as https", () => {
    configure("https://console.example");
    const req = request({ host: "console.example" });
    (req as any).socket = { encrypted: true };
    expect(canonicalAuthorizeLocation(req)).toBeUndefined();
  });

  it("does not move anything when no public URL is configured: the base is then the request itself", () => {
    configure("");
    expect(
      canonicalAuthorizeLocation(request({ host: "console.example", "x-forwarded-proto": "http" }))
    ).toBeUndefined();
    expect(canonicalAuthorizeLocation(request({ host: "console.example" }))).toBeUndefined();
  });

  it("does not ask an http public URL to move to https", () => {
    configure("http://localhost:3000");
    expect(
      canonicalAuthorizeLocation(request({ host: "localhost:3000", "x-forwarded-proto": "http" }))
    ).toBeUndefined();
  });
});

describe("the attempt id carries the time of the attempt", () => {
  it("sorts as text in the order of the attempts, and still passes the check on cookie names", () => {
    const ids = [1_000_000_000_000, 1_700_000_000_000, 1_700_000_000_001, 2_500_000_000_000].map(
      t => newLoginBinding(t).attempt
    );
    expect([...ids].sort()).toEqual(ids);
    for (const id of ids) {
      expect(isValidLoginAttempt(id)).toBe(true);
    }
    expect(newLoginBinding(1_700_000_000_000).attempt.slice(0, 9)).toBe(
      (1_700_000_000_000).toString(36).padStart(9, "0")
    );
  });
});

describe("clearing the oldest binding cookies of a browser", () => {
  const withCookies = (names: string[], headers: Record<string, string> = { host: "console.example" }) =>
    ({
      headers,
      url: "/",
      query: {},
      cookies: Object.fromEntries(names.map(n => [n, "v"])),
    } as unknown as NextApiRequest);
  const attemptsAt = (n: number) =>
    Array.from({ length: n }, (_v, i) => newLoginBinding(1_700_000_000_000 + i * 1000).attempt);
  const clearedNames = (set: string[]) => set.map(c => c.split("=")[0]);

  it("clears nothing while there is room for the new one", () => {
    configure("https://console.example");
    const ids = attemptsAt(MAX_PENDING_LOGIN_BINDINGS - 1);
    const req = withCookies(ids.map(i => `__Host-oidc-login-state-${i}`));
    expect(clearStaleLoginBindingCookies(req)).toEqual([]);
  });

  it("clears the oldest ones, so that the bound holds once the new cookie is set", () => {
    configure("https://console.example");
    const ids = attemptsAt(9);
    const req = withCookies([...ids].reverse().map(i => `__Host-oidc-login-state-${i}`));
    const cleared = clearedNames(clearStaleLoginBindingCookies(req));
    // 9 present, the new one makes 10: keep the newest MAX - 1 of the present ones
    expect(cleared).toHaveLength(9 - (MAX_PENDING_LOGIN_BINDINGS - 1));
    expect(cleared.sort()).toEqual(
      ids
        .slice(0, 9 - (MAX_PENDING_LOGIN_BINDINGS - 1))
        .map(i => `__Host-oidc-login-state-${i}`)
        .sort()
    );
    for (const c of clearStaleLoginBindingCookies(req)) {
      expect(c.toLowerCase()).toContain("max-age=0");
    }
  });

  it("leaves alone cookies that are not binding cookies as this server names them", () => {
    configure("https://console.example");
    const ids = attemptsAt(9);
    const req = withCookies([
      "oidc-session",
      "next-auth.session-token",
      "oidc-login-state-" + ids[0], // the plain name, which this server does not use over https
      "__Host-oidc-login-state-x", // not an attempt id
      "__Host-oidc-login-state-a;b=cdefghijk",
      ...ids.map(i => `__Host-oidc-login-state-${i}`),
    ]);
    const cleared = clearedNames(clearStaleLoginBindingCookies(req));
    // exactly the oldest ones of the nine real attempts, each once: the odd names are not counted and not touched
    expect(cleared.sort()).toEqual(
      ids
        .slice(0, 9 - (MAX_PENDING_LOGIN_BINDINGS - 1))
        .map(i => `__Host-oidc-login-state-${i}`)
        .sort()
    );
  });

  it("copes with a request that has no cookies at all", () => {
    configure("https://console.example");
    expect(
      clearStaleLoginBindingCookies({ headers: { host: "console.example" } } as unknown as NextApiRequest)
    ).toEqual([]);
  });
});

describe("the scheme of a request behind a proxy", () => {
  // Next.js fills in x-forwarded-proto from its own socket when the proxy did not send it, so with a proxy that sends only
  // x-forwarded-protocol: https the request carries "http" in the first header and "https" in the second
  it.each([
    ["only x-forwarded-proto: https", { "x-forwarded-proto": "https" }, "https"],
    ["only x-forwarded-proto: http", { "x-forwarded-proto": "http" }, "http"],
    ["only x-forwarded-protocol: https", { "x-forwarded-protocol": "https" }, "https"],
    [
      "a synthesized http next to a real https protocol header",
      { "x-forwarded-proto": "http", "x-forwarded-protocol": "https" },
      "https",
    ],
    [
      "https next to an http protocol header",
      { "x-forwarded-proto": "https", "x-forwarded-protocol": "http" },
      "https",
    ],
    ["a list that starts with https", { "x-forwarded-proto": "https, http" }, "https"],
    ["a list that starts with http", { "x-forwarded-proto": "http, https" }, "http"],
    ["upper case", { "x-forwarded-proto": "HTTPS" }, "https"],
    ["an odd value is no signal at all: the URL decides", { "x-forwarded-proto": "gopher" }, "http"],
    ["a protocol version is no signal either", { "x-forwarded-proto": "HTTP/2" }, "http"],
    [
      "an odd value next to a real one: the real one decides",
      { "x-forwarded-proto": "HTTP/2", "x-forwarded-protocol": "https" },
      "https",
    ],
    ["an odd value next to a real http", { "x-forwarded-proto": "gopher", "x-forwarded-protocol": "http" }, "http"],
    ["nothing", {}, "http"],
  ])("%s", (_name, headers, expected) => {
    expect(requestScheme(request(headers))).toBe(expected);
  });

  it("falls back to the URL of the request, as the callback always did", () => {
    expect(requestScheme(request({}, "https://x.example/a"))).toBe("https");
  });

  it("treats http next to https as doubt, not as https: the request is sent once to the https address", () => {
    configure("https://console.example");
    expect(
      canonicalAuthorizeLocation(
        request({ host: "console.example", "x-forwarded-proto": "http", "x-forwarded-protocol": "https" })
      )
    ).toBeDefined();
  });

  it("marks the cookie Secure and uses an https base when the only https signal is x-forwarded-protocol", () => {
    configure("");
    const req = request({ host: "console.example", "x-forwarded-proto": "http", "x-forwarded-protocol": "https" });
    expect(oidcBaseUrl(req)).toBe("https://console.example");
    expect(loginBindingCookie(req, "attempt12345", "v").toLowerCase()).toContain("secure");
  });
});

describe("only an exact http or https is a statement about the scheme", () => {
  it.each(["HTTP/2", "HTTP/1.1", "gopher", "ws", "h2c", "off", "true", "1", "https:", "httpss", "http s"])(
    "the forwarded value %j is doubt: an https public URL sends the request to the https address",
    value => {
      configure("https://console.example");
      expect(
        canonicalAuthorizeLocation(request({ host: "console.example", "x-forwarded-proto": value }))
      ).toBeDefined();
      expect(
        canonicalAuthorizeLocation(request({ host: "console.example", "x-forwarded-protocol": value }))
      ).toBeDefined();
    }
  );

  it("moves a request that is explicitly http, in any case and from a list", () => {
    configure("https://console.example");
    for (const value of ["http", "HTTP", " Http ", "http, https"]) {
      expect(
        canonicalAuthorizeLocation(request({ host: "console.example", "x-forwarded-proto": value })),
        value
      ).toBeDefined();
    }
  });

  it("uses the URL of the request when the only forwarded values are odd ones", () => {
    expect(requestScheme(request({ "x-forwarded-proto": "HTTP/2" }, "https://x.example/a"))).toBe("https");
  });
});
