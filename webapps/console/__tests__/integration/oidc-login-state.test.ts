import { afterEach, describe, expect, it, vi } from "vitest";
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
    socket: { remoteAddress: "127.0.0.1" },
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
  server.use(
    http.post(`${IDP}/token`, async ({ request }) => {
      const body = new URLSearchParams(await request.text());
      const code = body.get("code") ?? "";
      tokenCalls.push(code);
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
  const finishLogin = (jar: Jar, flow: { state: string; code: string }) =>
    call(callbackRoute, { code: flow.code, state: flow.state }, jar);
  // the callback stores emails in lower case, and the test emails carry random ids: compare in lower case on purpose
  const userCount = (email: string) => deps().prisma.userProfile.count({ where: { email: email.toLowerCase() } });
  return { workspace, provider, startLogin, finishLogin, tokenCalls, userCount };
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
    const { cookie } = await start("https://console.canonical.test", { host: "console.canonical.test" });
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

  it("is Secure when the configured URL is https even though the request itself looks like plain http", async () => {
    const { cookie } = await start("https://console.canonical.test", { host: "console.canonical.test" });
    expect(cookie.attrs["secure"]).toBe(true);
  });

  it("is Secure when a TLS proxy forwards only x-forwarded-protocol and nothing is configured", async () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("JITSU_PUBLIC_URL", "");
    const { cookie } = await start(undefined, { "x-forwarded-protocol": "https" });
    expect(cookie.attrs["secure"]).toBe(true);
    expect(cookie.name.startsWith("__Host-")).toBe(true);
  });

  it("the callback finds that cookie again: a login over https completes", async () => {
    const { flow, t } = await start("https://console.canonical.test", { host: "console.canonical.test" });
    const jar = new Jar();
    jar.apply(flow.started.setCookie);
    const done = await t.finishLogin(jar, flow);
    expect(done.location).toBe(`/${t.workspace.slug || t.workspace.id}`);
  });
});
