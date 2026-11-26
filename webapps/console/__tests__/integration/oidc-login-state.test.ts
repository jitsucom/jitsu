import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { http, HttpResponse } from "msw";
import { randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import { nextAuthConfig } from "../../lib/nextauth.config";
import authorizeRoute from "../../pages/api/auth/dynamic-oidc/authorize";
import callbackRoute from "../../pages/api/auth/dynamic-oidc/callback";

// JITSU-302: the OIDC login flow must finish in the browser that started it. The signed `state` alone is not enough: it
// travels in the callback URL, so whoever holds it can hand that URL to someone else. The tests run the real authorize and
// callback handlers against a real database, with the identity provider stubbed at its token endpoint.

const IDP = "https://idp.login-state.test";

type Cookie = { name: string; value: string; attrs: Record<string, string | true> };

function parseSetCookie(header: string | string[] | undefined): Cookie[] {
  return (Array.isArray(header) ? header : header ? [header] : []).map(line => {
    const [pair, ...rest] = line.split(";").map(s => s.trim());
    const eq = pair.indexOf("=");
    const attrs: Record<string, string | true> = {};
    for (const a of rest) {
      const i = a.indexOf("=");
      attrs[(i < 0 ? a : a.slice(0, i)).toLowerCase()] = i < 0 ? true : a.slice(i + 1);
    }
    return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs };
  });
}

/** What a browser keeps: applies the Set-Cookie headers of a response, deleting cookies that expire at once. */
class Jar {
  cookies = new Map<string, string>();
  apply(cookies: Cookie[]) {
    for (const c of cookies) {
      const gone = c.attrs["max-age"] === "0" || c.value === "" || /1970/.test(String(c.attrs["expires"] ?? ""));
      if (gone) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
  }
}

async function call(handler: NextApiHandler, query: Record<string, string>, jar: Jar, extraHeaders = {}) {
  const out = {
    status: 200,
    location: undefined as string | undefined,
    setCookie: [] as Cookie[],
    body: undefined as any,
  };
  const headers: Record<string, any> = {};
  const res = {
    setHeader(k: string, v: any) {
      headers[k.toLowerCase()] = v;
      return this;
    },
    getHeader: (k: string) => headers[k.toLowerCase()],
    status(code: number) {
      out.status = code;
      return this;
    },
    json(b: any) {
      out.body = b;
      return this;
    },
    redirect(a: number | string, b?: string) {
      out.status = typeof a === "number" ? a : 302;
      out.location = typeof a === "number" ? b : a;
      return this;
    },
  };
  const cookies = Object.fromEntries(jar.cookies);
  const req = {
    method: "GET",
    url: `${(extraHeaders as any)["x-test-path"] ?? "/"}${
      Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : ""
    }`,
    query,
    headers: {
      host: "console.test.local", // the host of the NEXTAUTH_URL of the test environment
      "x-real-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${
        1 + Math.floor(Math.random() * 250)
      }`,
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      ...extraHeaders,
    },
    cookies,
    socket: { remoteAddress: "127.0.0.1", encrypted: (extraHeaders as any)["x-test-tls"] === "1" },
  } as unknown as NextApiRequest;
  await handler(req, res as unknown as NextApiResponse);
  out.setCookie = parseSetCookie(headers["set-cookie"]);
  jar.apply(out.setCookie);
  return out;
}

/** A provider, a workspace that lets every user of it in, and a stub identity provider that issues codes for given users. */
async function setup() {
  const { workspace } = await seedWorkspace();
  const clientId = `client-${randomId(8)}`;
  const provider = await deps().prisma.oidcProvider.create({
    data: {
      name: "Login state test",
      issuer: IDP,
      clientId,
      clientSecret: "secret",
      authorizationEndpoint: `${IDP}/authorize`,
      tokenEndpoint: `${IDP}/token`,
      autoDiscovery: false,
    },
  });
  await deps().prisma.oidcLoginGroup.create({
    data: { workspaceId: workspace.id, oidcProviderId: provider.id, allowAllUsers: true },
  });
  const issued = new Map<string, { nonce: string; sub: string; email: string }>();
  const tokenCalls: string[] = [];
  const tokenRedirectUris: (string | null)[] = [];
  server.use(
    http.post(`${IDP}/token`, async ({ request }) => {
      const body = new URLSearchParams(await request.text());
      const code = body.get("code") ?? "";
      tokenCalls.push(code);
      tokenRedirectUris.push(body.get("redirect_uri"));
      const user = issued.get(code);
      if (!user) return HttpResponse.json({ error: "invalid_grant" }, { status: 400 });
      const id_token = jwt.sign(
        { iss: IDP, aud: clientId, sub: user.sub, email: user.email, name: user.email, nonce: user.nonce },
        "idp-key",
        { expiresIn: "5m" }
      );
      return HttpResponse.json({ access_token: `at-${code}`, refresh_token: `rt-${code}`, id_token, expires_in: 3600 });
    })
  );
  /** The browser of someone who starts a login: authorize, then the user signs in at the IdP, which issues a code. */
  const startLogin = async (jar: Jar, who: { sub: string; email: string }, headers = {}) => {
    const started = await call(authorizeRoute, { providerId: provider.id }, jar, headers);
    expect(started.status).toBe(302);
    const url = new URL(started.location!);
    expect(url.origin).toBe(IDP);
    const state = url.searchParams.get("state")!;
    const code = `code-${randomId(8)}`;
    issued.set(code, { nonce: url.searchParams.get("nonce")!, ...who });
    return { state, code, started };
  };
  const finishLogin = (jar: Jar, flow: { state: string; code: string }, headers = {}) =>
    call(callbackRoute, { code: flow.code, state: flow.state }, jar, headers);
  // the callback stores emails in lower case, and the test emails carry random ids: compare in lower case on purpose
  const userCount = (email: string) => deps().prisma.userProfile.count({ where: { email: email.toLowerCase() } });
  return { workspace, provider, startLogin, finishLogin, tokenCalls, tokenRedirectUris, userCount };
}

const refusedAsInvalidState = (r: { location?: string }) => {
  expect(r.location).toBeDefined();
  const url = new URL(r.location!, "http://x");
  expect(url.pathname).toBe("/signin");
  expect(url.searchParams.get("error")).toBe("invalid_state");
};

describe("the OIDC login finishes only in the browser that started it", () => {
  it("a normal login works: the browser that started it gets a session, and the binding cookie is spent", async () => {
    const t = await setup();
    const me = `me-${randomId(6)}@login-state.test`;
    const jar = new Jar();
    const flow = await t.startLogin(jar, { sub: `sub-${randomId(6)}`, email: me });
    const done = await t.finishLogin(jar, flow);
    expect(done.status).toBe(302);
    expect(done.location).toBe(`/${t.workspace.slug || t.workspace.id}`);
    expect(done.setCookie.map(c => c.name)).toContain("oidc-session");
    expect(await t.userCount(me)).toBe(1);
    expect(bindingNames(jar)).toHaveLength(0);
    expect(jar.cookies.has("oidc-session")).toBe(true);
  });

  it("the authorize redirect sets a binding cookie that is HttpOnly, Lax, scoped to the OIDC routes and short-lived", async () => {
    const t = await setup();
    const jar = new Jar();
    const flow = await t.startLogin(jar, { sub: "s1", email: `a-${randomId(6)}@login-state.test` });
    const cookie = flow.started.setCookie.find(isBinding);
    expect(cookie, "no binding cookie is set").toBeDefined();
    // one cookie per login attempt, named after the attempt id that is also in the signed state
    const attempt = (jwt.decode(flow.state) as any).attempt;
    expect(cookie!.name).toBe(`oidc-login-state-${attempt}`);
    expect(cookie!.value.length).toBeGreaterThanOrEqual(22);
    expect(cookie!.attrs["httponly"]).toBe(true);
    // Strict would drop the cookie on the redirect back from the identity provider, which is a cross-site navigation
    expect(String(cookie!.attrs["samesite"]).toLowerCase()).toBe("lax");
    expect(cookie!.attrs["path"]).toBe("/api/auth/dynamic-oidc");
    expect(Number(cookie!.attrs["max-age"])).toBeGreaterThan(0);
    expect(Number(cookie!.attrs["max-age"])).toBeLessThanOrEqual(600);
    // the value is not in the state, so the state alone does not reveal it
    expect(flow.state).not.toContain(cookie!.value);
    expect(Buffer.from(flow.state.split(".")[1], "base64url").toString()).not.toContain(cookie!.value);
  });

  it("is Secure when nothing is configured and the proxy says https with x-forwarded-proto", async () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("JITSU_PUBLIC_URL", "");
    const t = await setup();
    const flow = await t.startLogin(
      new Jar(),
      { sub: "s2", email: `b-${randomId(6)}@login-state.test` },
      { "x-forwarded-proto": "https" }
    );
    expect(flow.started.setCookie.find(isBinding)?.attrs["secure"]).toBe(true);
  });

  it("refuses a callback URL handed to another browser: no session, no user, the code is not even exchanged", async () => {
    const t = await setup();
    const attacker = `attacker-${randomId(6)}@login-state.test`;
    const attackerFlow = await t.startLogin(new Jar(), { sub: `sub-${randomId(6)}`, email: attacker });
    // the victim's browser has no cookie of this flow
    const victim = new Jar();
    const r = await t.finishLogin(victim, attackerFlow);
    refusedAsInvalidState(r);
    expect(r.setCookie.map(c => c.name)).not.toContain("oidc-session");
    expect(victim.cookies.has("oidc-session")).toBe(false);
    expect(t.tokenCalls).toEqual([]);
    expect(await t.userCount(attacker)).toBe(0);
  });

  it("refuses it also when the victim has a login of their own going, and that login still completes", async () => {
    const t = await setup();
    const attacker = `attacker-${randomId(6)}@login-state.test`;
    const me = `victim-${randomId(6)}@login-state.test`;
    const attackerFlow = await t.startLogin(new Jar(), { sub: `sub-${randomId(6)}`, email: attacker });
    const victim = new Jar();
    const own = await t.startLogin(victim, { sub: `sub-${randomId(6)}`, email: me });
    const r = await t.finishLogin(victim, attackerFlow);
    refusedAsInvalidState(r);
    expect(victim.cookies.has("oidc-session")).toBe(false);
    expect(await t.userCount(attacker)).toBe(0);
    // the refusal did not spend the victim's own binding
    const done = await t.finishLogin(victim, own);
    expect(done.status).toBe(302);
    expect(done.setCookie.map(c => c.name)).toContain("oidc-session");
    expect(await t.userCount(me)).toBe(1);
  });

  it("refuses a cookie that does not match the state, and an empty one", async () => {
    const t = await setup();
    for (const value of ["tampered-value-0123456789", ""]) {
      const jar = new Jar();
      const flow = await t.startLogin(jar, { sub: `sub-${randomId(6)}`, email: `c-${randomId(6)}@login-state.test` });
      jar.cookies.set(flow.started.setCookie.find(isBinding)!.name, value);
      refusedAsInvalidState(await t.finishLogin(jar, flow));
      expect(jar.cookies.has("oidc-session")).toBe(false);
    }
    expect(t.tokenCalls).toEqual([]);
  });

  it("a finished login cannot be replayed: the binding is spent", async () => {
    const t = await setup();
    const jar = new Jar();
    const flow = await t.startLogin(jar, { sub: `sub-${randomId(6)}`, email: `d-${randomId(6)}@login-state.test` });
    expect((await t.finishLogin(jar, flow)).setCookie.map(c => c.name)).toContain("oidc-session");
    const replayJar = new Jar();
    refusedAsInvalidState(await t.finishLogin(replayJar, flow));
    refusedAsInvalidState(await t.finishLogin(jar, flow));
    expect(t.tokenCalls).toHaveLength(1);
  });

  it("refuses a validly signed state that carries no binding, such as one issued before the binding existed", async () => {
    const t = await setup();
    const me = `old-${randomId(6)}@login-state.test`;
    const jar = new Jar();
    const flow = await t.startLogin(jar, { sub: `sub-${randomId(6)}`, email: me });
    const nonce = jwt.decode(flow.state) as any;
    const unbound = jwt.sign(
      {
        providerId: t.provider.id,
        timestamp: Date.now(),
        csrfToken: "x",
        codeVerifier: nonce.codeVerifier,
        nonce: nonce.nonce,
      },
      nextAuthConfig.secret as string,
      { expiresIn: "10m" }
    );
    // with the cookie of a real login of this browser, and without any cookie
    refusedAsInvalidState(await t.finishLogin(jar, { state: unbound, code: flow.code }));
    refusedAsInvalidState(await t.finishLogin(new Jar(), { state: unbound, code: flow.code }));
    expect(t.tokenCalls).toEqual([]);
    expect(await t.userCount(me)).toBe(0);
  });

  it("refuses a signed state whose attempt id is not one that authorize issues, so nothing odd becomes a cookie name", async () => {
    const t = await setup();
    const jar = new Jar();
    const flow = await t.startLogin(jar, { sub: `sub-${randomId(6)}`, email: `e-${randomId(6)}@login-state.test` });
    const original = jwt.decode(flow.state) as any;
    for (const attempt of ["", "x", "a;path=/", "../../etc", "a b c d e f g h", "x".repeat(200), 42, null, { a: 1 }]) {
      const { exp: _exp, iat: _iat, ...claims } = original;
      const odd = jwt.sign({ ...claims, attempt }, nextAuthConfig.secret as string, {
        expiresIn: "10m",
      });
      refusedAsInvalidState(await t.finishLogin(jar, { state: odd, code: flow.code }));
    }
    expect(t.tokenCalls).toEqual([]);
  });

  it("spends the binding even when the login then fails, so the same state cannot be tried again", async () => {
    const t = await setup();
    const me = `late-${randomId(6)}@login-state.test`;
    const jar = new Jar();
    const flow = await t.startLogin(jar, { sub: `sub-${randomId(6)}`, email: me });
    // the browser is the right one, but the identity provider does not know this code
    const failed = await t.finishLogin(jar, { state: flow.state, code: "code-the-idp-never-issued" });
    expect(new URL(failed.location!, "http://x").searchParams.get("error")).toBe("token_exchange_failed");
    expect(bindingNames(jar)).toHaveLength(0);
    // the real code with the same state no longer works
    refusedAsInvalidState(await t.finishLogin(jar, flow));
    expect(await t.userCount(me)).toBe(0);
  });
});

// JITSU-302, review follow-ups: the binding cookie must survive two logins of one browser, belong to the host the identity
// provider returns to, be Secure by the public URL and not be suppliable by a sibling host.
// the harness sets JITSU_PUBLIC_URL to the fixture origin but would inherit NEXTAUTH_URL from the environment of a developer
// (.env.local), which comes first and would send every request of these tests to another host
beforeEach(() => vi.stubEnv("NEXTAUTH_URL", "http://console.test.local"));
afterEach(() => vi.unstubAllEnvs());
const isBinding = (c: Cookie) => c.name.includes("oidc-login-state");
const bindingNames = (jar: Jar) => [...jar.cookies.keys()].filter(n => n.includes("oidc-login-state"));
const AUTHORIZE_PATH = "/api/auth/dynamic-oidc/authorize";

describe("two logins of one browser at the same time", () => {
  it.each(["the first one finishes first", "the second one finishes first"])(
    "both complete, each spending only its own cookie: %s",
    async order => {
      const t = await setup();
      const jar = new Jar();
      const a = await t.startLogin(jar, { sub: `sa-${randomId(6)}`, email: `a-${randomId(6)}@login-state.test` });
      const b = await t.startLogin(jar, { sub: `sb-${randomId(6)}`, email: `b-${randomId(6)}@login-state.test` });
      expect(bindingNames(jar)).toHaveLength(2);
      const [first, second] = order.startsWith("the first") ? [a, b] : [b, a];
      const doneFirst = await t.finishLogin(jar, first);
      expect(doneFirst.location).toBe(`/${t.workspace.slug || t.workspace.id}`);
      // the other login's cookie is still there
      expect(bindingNames(jar)).toHaveLength(1);
      const doneSecond = await t.finishLogin(jar, second);
      expect(doneSecond.location).toBe(`/${t.workspace.slug || t.workspace.id}`);
      expect(bindingNames(jar)).toHaveLength(0);
    }
  );

  it("a callback link of one attempt is not accepted with the cookie of another attempt of the same browser", async () => {
    const t = await setup();
    const jar = new Jar();
    const mine = await t.startLogin(jar, { sub: `sm-${randomId(6)}`, email: `m-${randomId(6)}@login-state.test` });
    const otherJar = new Jar();
    const theirs = await t.startLogin(otherJar, {
      sub: `st-${randomId(6)}`,
      email: `t-${randomId(6)}@login-state.test`,
    });
    // my browser holds only its own cookie: their callback URL, followed in my browser, is refused
    refusedAsInvalidState(await t.finishLogin(jar, theirs));
    expect(bindingNames(jar)).toHaveLength(1); // and my own login is not spent by it
    expect((await t.finishLogin(jar, mine)).location).toBe(`/${t.workspace.slug || t.workspace.id}`);
  });
});

describe("the login starts on the host the identity provider returns to", () => {
  const CANONICAL = "https://console.canonical.test";
  const onHost = (host: string, extra: Record<string, string> = {}) => ({
    host,
    "x-forwarded-proto": "https", // as a TLS proxy sends it: the request is on the right host AND positively https
    "x-test-path": AUTHORIZE_PATH,
    ...extra,
  });

  it("sends a browser that arrives on another host to the configured one, once, and sets no cookie yet", async () => {
    vi.stubEnv("NEXTAUTH_URL", CANONICAL);
    const t = await setup();
    const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), onHost("alias.login-state.test"));
    expect(r.status).toBe(302);
    const url = new URL(r.location!);
    expect(url.origin).toBe(CANONICAL);
    expect(url.pathname).toBe(AUTHORIZE_PATH);
    expect(url.searchParams.get("providerId")).toBe(t.provider.id);
    expect(url.searchParams.get("_canonical")).toBe("1");
    expect(r.setCookie.filter(isBinding)).toHaveLength(0);
  });

  it("starts the login on the configured host itself, and does not bounce a request that already was bounced", async () => {
    vi.stubEnv("NEXTAUTH_URL", CANONICAL);
    const t = await setup();
    const onCanonical = await call(
      authorizeRoute,
      { providerId: t.provider.id },
      new Jar(),
      onHost("console.canonical.test")
    );
    expect(new URL(onCanonical.location!).origin).toBe(IDP);
    expect(onCanonical.setCookie.filter(isBinding)).toHaveLength(1);
    // a proxy that hides the public host would otherwise loop for ever
    const bounced = await call(
      authorizeRoute,
      { providerId: t.provider.id, _canonical: "1" },
      new Jar(),
      onHost("internal-name:3000")
    );
    expect(new URL(bounced.location!).origin).toBe(IDP);
  });

  it("goes only to the configured host, whatever the request says", async () => {
    vi.stubEnv("NEXTAUTH_URL", CANONICAL);
    const t = await setup();
    for (const hostile of [
      { host: "evil.example", "x-test-path": "//evil.example/x" },
      { host: "evil.example", "x-forwarded-host": "evil.example", "x-test-path": AUTHORIZE_PATH },
      { host: "alias.login-state.test", "x-test-path": "/\\evil.example" },
    ]) {
      const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), hostile);
      expect(r.status).toBe(302);
      expect(new URL(r.location!).origin).toBe(CANONICAL);
    }
  });
});

describe("the binding cookie follows the public URL", () => {
  const start = async (base: string | undefined, headers: Record<string, string>) => {
    if (base) vi.stubEnv("NEXTAUTH_URL", base);
    const t = await setup();
    const flow = await t.startLogin(
      new Jar(),
      { sub: `sx-${randomId(6)}`, email: `x-${randomId(6)}@login-state.test` },
      headers
    );
    const cookie = flow.started.setCookie.find(isBinding)!;
    expect(cookie, "no binding cookie is set").toBeDefined();
    return { cookie, flow, t };
  };

  it("on https the cookie is a __Host- cookie: Secure, Path=/, no Domain, so a sibling host cannot supply it", async () => {
    const { cookie } = await start("https://console.canonical.test", {
      host: "console.canonical.test",
      "x-forwarded-proto": "https",
    });
    expect(cookie.name.startsWith("__Host-")).toBe(true);
    expect(cookie.attrs["secure"]).toBe(true);
    expect(cookie.attrs["path"]).toBe("/");
    expect(cookie.attrs["domain"]).toBeUndefined();
    expect(cookie.attrs["httponly"]).toBe(true);
    expect(String(cookie.attrs["samesite"]).toLowerCase()).toBe("lax");
  });

  it("on plain http (local development) the cookie has the plain name, the narrow path and no Secure", async () => {
    const { cookie } = await start("http://localhost:3000", { host: "localhost:3000" });
    expect(cookie.name.startsWith("__Host-")).toBe(false);
    expect(cookie.attrs["secure"]).toBeUndefined();
    expect(cookie.attrs["path"]).toBe("/api/auth/dynamic-oidc");
  });

  it("is Secure when the configured URL is https even on the request that was already sent once and still looks like plain http", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://console.canonical.test");
    const t = await setup();
    const r = await call(authorizeRoute, { providerId: t.provider.id, _canonical: "1" }, new Jar(), {
      host: "console.canonical.test",
      "x-forwarded-proto": "http",
      "x-test-path": AUTHORIZE_PATH,
    });
    const cookie = r.setCookie.find(isBinding)!;
    expect(cookie.attrs["secure"]).toBe(true);
    expect(cookie.name.startsWith("__Host-")).toBe(true);
  });

  it("is Secure when a TLS proxy forwards only x-forwarded-protocol and nothing is configured", async () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("JITSU_PUBLIC_URL", "");
    const { cookie } = await start(undefined, { "x-forwarded-protocol": "https" });
    expect(cookie.attrs["secure"]).toBe(true);
    expect(cookie.name.startsWith("__Host-")).toBe(true);
  });

  it("the callback finds that cookie again: a login over https completes", async () => {
    const { flow, t } = await start("https://console.canonical.test", {
      host: "console.canonical.test",
      "x-forwarded-proto": "https",
    });
    const jar = new Jar();
    jar.apply(flow.started.setCookie);
    const done = await t.finishLogin(jar, flow);
    expect(done.location).toBe(`/${t.workspace.slug || t.workspace.id}`);
  });
});

describe("a request over plain http to the host of an https public URL", () => {
  const SECURE_BASE = "https://console.test.local";

  it("is sent once to the https address before a binding cookie is set, because a Secure cookie set over http is dropped", async () => {
    vi.stubEnv("NEXTAUTH_URL", SECURE_BASE);
    const t = await setup();
    const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), {
      "x-test-path": AUTHORIZE_PATH,
      "x-forwarded-proto": "http",
    });
    expect(r.status).toBe(302);
    expect(new URL(r.location!).origin).toBe(SECURE_BASE);
    expect(new URL(r.location!).searchParams.get("_canonical")).toBe("1");
    expect(r.setCookie.filter(isBinding)).toEqual([]);
  });

  it("is not sent again once it carries the marker, so a proxy that hides https cannot make it loop", async () => {
    vi.stubEnv("NEXTAUTH_URL", SECURE_BASE);
    const t = await setup();
    const r = await call(authorizeRoute, { providerId: t.provider.id, _canonical: "1" }, new Jar(), {
      "x-test-path": AUTHORIZE_PATH,
      "x-forwarded-proto": "http",
    });
    expect(new URL(r.location!).origin).not.toBe(SECURE_BASE);
    expect(r.setCookie.filter(isBinding)).toHaveLength(1);
  });

  it("is sent once to the https address when http comes next to https, because that is doubt", async () => {
    vi.stubEnv("NEXTAUTH_URL", SECURE_BASE);
    const t = await setup();
    const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), {
      "x-test-path": AUTHORIZE_PATH,
      "x-forwarded-proto": "http",
      "x-forwarded-protocol": "https",
    });
    expect(new URL(r.location!).origin).toBe(SECURE_BASE);
    expect(r.setCookie.filter(isBinding)).toEqual([]);
  });

  it("exchanges the code with the same redirect URI that the login started with, behind a proxy that sends only x-forwarded-protocol", async () => {
    // nothing configured: the base is built from the request, so authorize and callback must read the scheme the same way
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("JITSU_PUBLIC_URL", "");
    vi.stubEnv("JITSU_PUBLIC", "");
    const t = await setup();
    const proxy = { "x-forwarded-proto": "http", "x-forwarded-protocol": "https" };
    const jar = new Jar();
    const flow = await t.startLogin(
      jar,
      { sub: `s-${randomId(6)}`, email: `r-${randomId(6)}@login-state.test` },
      proxy
    );
    const sent = new URL(flow.started.location!).searchParams.get("redirect_uri");
    expect(sent).toBe("https://console.test.local/api/auth/dynamic-oidc/callback");
    const done = await t.finishLogin(jar, flow, proxy);
    expect(done.setCookie.map(c => c.name)).toContain("oidc-session");
    expect(t.tokenRedirectUris).toEqual([sent]);
  });

  it("is sent once to the https address for a forwarded value that is not a scheme, such as HTTP/1.1", async () => {
    vi.stubEnv("NEXTAUTH_URL", SECURE_BASE);
    const t = await setup();
    for (const value of ["HTTP/1.1", "gopher"]) {
      const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), {
        "x-test-path": AUTHORIZE_PATH,
        "x-forwarded-proto": value,
      });
      expect(new URL(r.location!).origin, value).toBe(SECURE_BASE);
      expect(r.setCookie.filter(isBinding), value).toEqual([]);
    }
  });

  it("is sent once to the https address when the proxy says http, even if it connects over TLS", async () => {
    vi.stubEnv("NEXTAUTH_URL", SECURE_BASE);
    const t = await setup();
    const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), {
      "x-test-path": AUTHORIZE_PATH,
      "x-forwarded-proto": "http",
      "x-test-tls": "1",
    });
    expect(new URL(r.location!).origin).toBe(SECURE_BASE);
    expect(r.setCookie.filter(isBinding)).toEqual([]);
  });

  it("is sent once to the https address when the proxy says nothing about the scheme", async () => {
    vi.stubEnv("NEXTAUTH_URL", SECURE_BASE);
    const t = await setup();
    const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), { "x-test-path": AUTHORIZE_PATH });
    expect(new URL(r.location!).origin).toBe(SECURE_BASE);
  });

  it("costs no login budget: any number of such redirects leaves the whole limit to the real requests", async () => {
    vi.stubEnv("NEXTAUTH_URL", SECURE_BASE);
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "2");
    const t = await setup();
    const ip = { "x-real-ip": `198.51.100.${1 + Math.floor(Math.random() * 250)}` };
    for (let i = 0; i < 6; i++) {
      const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), {
        "x-test-path": AUTHORIZE_PATH,
        ...ip,
      });
      expect(r.status, `redirect ${i}`).toBe(302);
      expect(new URL(r.location!).origin).toBe(SECURE_BASE);
    }
    const real = { "x-test-path": AUTHORIZE_PATH, "x-forwarded-proto": "https", ...ip };
    for (let i = 0; i < 2; i++) {
      const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), real);
      expect(r.status, `real request ${i}`).toBe(302);
      expect(new URL(r.location!).origin).not.toBe(SECURE_BASE);
    }
    // control: the limiter is live, so the third real request is refused
    expect((await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), real)).status).toBe(429);
  });

  it("is left alone when the proxy positively says https", async () => {
    vi.stubEnv("NEXTAUTH_URL", SECURE_BASE);
    const t = await setup();
    for (const headers of [{ "x-forwarded-proto": "https" }, { "x-forwarded-protocol": "https" }]) {
      const r = await call(authorizeRoute, { providerId: t.provider.id }, new Jar(), {
        "x-test-path": AUTHORIZE_PATH,
        ...headers,
      });
      expect(r.setCookie.filter(isBinding), JSON.stringify(headers)).toHaveLength(1);
      expect(new URL(r.location!).origin).not.toBe(SECURE_BASE);
    }
  });
});

describe("abandoned logins", () => {
  it("a finished login clears at most three surplus cookies, and a few logins bring a big surplus down to the bound", async () => {
    const t = await setup();
    const jar = new Jar();
    // the surplus appears after the login started, as when overlapping starts land together: the callback faces all of it
    const flow = await t.startLogin(jar, { sub: `c0-${randomId(5)}`, email: `c0-${randomId(5)}@login-state.test` });
    for (let i = 0; i < 20; i++) {
      jar.cookies.set(
        `oidc-login-state-00000000${String.fromCharCode(97 + i)}${randomId(10)}`,
        `stale-${randomId(10)}`
      );
    }
    expect(bindingNames(jar)).toHaveLength(21);
    const done = await t.finishLogin(jar, flow);
    expect(done.setCookie.map(c => c.name)).toContain("oidc-session");
    // its own cookie and exactly three of the surplus: never a header per surplus cookie
    expect(done.setCookie.filter(isBinding)).toHaveLength(4);
    expect(bindingNames(jar)).toHaveLength(17);
    // later logins clear more, three at the start and three at the end of each, until the bound holds
    let cycles = 0;
    while (bindingNames(jar).length > 5 && cycles < 12) {
      const next = await t.startLogin(jar, {
        sub: `c${cycles + 1}-${randomId(5)}`,
        email: `c${cycles + 1}-${randomId(5)}@login-state.test`,
      });
      const finished = await t.finishLogin(jar, next);
      expect(finished.setCookie.map(c => c.name)).toContain("oidc-session");
      expect(finished.setCookie.filter(isBinding).length).toBeLessThanOrEqual(4);
      cycles++;
    }
    expect(bindingNames(jar).length).toBeLessThanOrEqual(5);
    expect(cycles).toBeLessThanOrEqual(3);
  });

  it("a finished login also clears the oldest abandoned ones, so a burst of overlapping starts is healed by the next login", async () => {
    const t = await setup();
    const jar = new Jar();
    const flows: { state: string; code: string }[] = [];
    for (let i = 0; i < 5; i++) {
      flows.push(
        await t.startLogin(jar, { sub: `h${i}-${randomId(5)}`, email: `h${i}-${randomId(5)}@login-state.test` })
      );
    }
    // what overlapping starts can leave behind: more cookies than the bound, older than the real logins
    for (let i = 0; i < 4; i++) {
      jar.cookies.set(`oidc-login-state-00000000${i}${randomId(11)}`, `stale-${randomId(10)}`);
    }
    expect(bindingNames(jar)).toHaveLength(9);
    const done = await t.finishLogin(jar, flows[4]);
    expect(done.setCookie.map(c => c.name)).toContain("oidc-session");
    // the finished login's own cookie is gone, and no more than the bound remain, none of them the oldest
    expect(bindingNames(jar)).toHaveLength(5);
    // the four real ones and the newest abandoned one stay; the three oldest abandoned ones are gone
    for (const i of [0, 1, 2])
      expect(bindingNames(jar).some(n => n.includes(`oidc-login-state-00000000${i}`))).toBe(false);
    expect(bindingNames(jar).some(n => n.includes("oidc-login-state-000000003"))).toBe(true);
    // the other real logins still work
    for (const flow of flows.slice(0, 4)) {
      expect((await t.finishLogin(jar, flow)).setCookie.map(c => c.name)).toContain("oidc-session");
    }
  });

  it("never leave more than a handful of binding cookies in one browser: the oldest ones are cleared when a new login starts", async () => {
    const t = await setup();
    const jar = new Jar();
    const flows: { state: string; code: string }[] = [];
    for (let i = 0; i < 12; i++) {
      flows.push(
        await t.startLogin(jar, { sub: `s${i}-${randomId(5)}`, email: `p${i}-${randomId(5)}@login-state.test` })
      );
      expect(bindingNames(jar).length).toBeLessThanOrEqual(5);
    }
    expect(bindingNames(jar)).toHaveLength(5);
    // the newest logins still work, each with its own cookie
    for (const flow of flows.slice(-5)) {
      const done = await t.finishLogin(jar, flow);
      expect(done.setCookie.map(c => c.name)).toContain("oidc-session");
    }
    expect(bindingNames(jar)).toHaveLength(0);
  });

  it("do not make a login fail that the browser started later than the abandoned ones", async () => {
    const t = await setup();
    const jar = new Jar();
    for (let i = 0; i < 8; i++) {
      await t.startLogin(jar, { sub: `x${i}-${randomId(5)}`, email: `x${i}-${randomId(5)}@login-state.test` });
    }
    const last = await t.startLogin(jar, { sub: `last-${randomId(5)}`, email: `last-${randomId(5)}@login-state.test` });
    expect((await t.finishLogin(jar, last)).setCookie.map(c => c.name)).toContain("oidc-session");
  });
});
