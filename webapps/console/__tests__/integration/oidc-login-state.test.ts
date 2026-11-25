import { describe, expect, it } from "vitest";
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
const BINDING_COOKIE = "oidc-login-state";

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
    url: "/",
    query,
    headers: {
      host: "console.login-state.test",
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
    expect(jar.cookies.has(BINDING_COOKIE)).toBe(false);
    expect(jar.cookies.has("oidc-session")).toBe(true);
  });

  it("the authorize redirect sets a binding cookie that is HttpOnly, Lax, scoped to the OIDC routes and short-lived", async () => {
    const t = await setup();
    const jar = new Jar();
    const flow = await t.startLogin(jar, { sub: "s1", email: `a-${randomId(6)}@login-state.test` });
    const cookie = flow.started.setCookie.find(c => c.name === BINDING_COOKIE);
    expect(cookie, "no binding cookie is set").toBeDefined();
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

  it("is Secure behind https", async () => {
    const t = await setup();
    const flow = await t.startLogin(
      new Jar(),
      { sub: "s2", email: `b-${randomId(6)}@login-state.test` },
      {
        "x-forwarded-proto": "https",
      }
    );
    expect(flow.started.setCookie.find(c => c.name === BINDING_COOKIE)?.attrs["secure"]).toBe(true);
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
      jar.cookies.set(BINDING_COOKIE, value);
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

  it("spends the binding even when the login then fails, so the same state cannot be tried again", async () => {
    const t = await setup();
    const me = `late-${randomId(6)}@login-state.test`;
    const jar = new Jar();
    const flow = await t.startLogin(jar, { sub: `sub-${randomId(6)}`, email: me });
    // the browser is the right one, but the identity provider does not know this code
    const failed = await t.finishLogin(jar, { state: flow.state, code: "code-the-idp-never-issued" });
    expect(new URL(failed.location!, "http://x").searchParams.get("error")).toBe("token_exchange_failed");
    expect(jar.cookies.has(BINDING_COOKIE)).toBe(false);
    // the real code with the same state no longer works
    refusedAsInvalidState(await t.finishLogin(jar, flow));
    expect(await t.userCount(me)).toBe(0);
  });
});
