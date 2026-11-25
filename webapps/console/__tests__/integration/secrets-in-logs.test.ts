import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { http, HttpResponse } from "msw";
import { randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import authorizeRoute from "../../pages/api/auth/dynamic-oidc/authorize";
import callbackRoute from "../../pages/api/auth/dynamic-oidc/callback";
import createSessionRoute from "../../pages/api/fb-auth/create-session";
import { isJwtToken } from "../../lib/server/oidc-token-service";
import { db } from "../../lib/server/db";

// JITSU-302: secrets must not reach the logs. Everything the code hands to its loggers is recorded here (the message, the
// arguments and the cause) and each test checks that a secret it planted in the code path is not in any of it.

const recorded = vi.hoisted(() => {
  const lines: string[] = [];
  const text = (v: unknown): string => {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v) ?? String(v);
    } catch {
      return String(v);
    }
  };
  const makeLog = () => {
    const builder = (level: string) => {
      let cause: unknown;
      const b: any = {
        log: (message: string, ...args: unknown[]) =>
          lines.push([level, message, ...args.map(text), cause === undefined ? "" : text(cause)].join(" | ")),
        withCause: (c: unknown) => {
          cause = c;
          return b;
        },
      };
      return b;
    };
    return {
      atDebug: () => builder("debug"),
      atInfo: () => builder("info"),
      atWarn: () => builder("warn"),
      atError: () => builder("error"),
    };
  };
  return { lines, makeLog };
});
vi.mock("../../lib/server/log", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/server/log")>()),
  getServerLog: () => recorded.makeLog(),
}));
vi.mock("juava", async importOriginal => ({
  ...(await importOriginal<typeof import("juava")>()),
  getLog: () => recorded.makeLog(),
}));

beforeEach(() => {
  recorded.lines.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

const everything = () => recorded.lines.join("\n");
const expectNoneOf = (...secrets: string[]) => {
  const all = everything();
  for (const s of secrets) {
    expect(all, `the logs contain ${s.length > 12 ? s.slice(0, 12) + "…" : s}`).not.toContain(s);
  }
};

async function call(
  handler: any,
  method: string,
  opts: { query?: any; body?: any; cookies?: Record<string, string> } = {}
) {
  const out = { status: 200, location: undefined as string | undefined, body: undefined as any };
  const res: any = {
    statusCode: 200,
    status(c: number) {
      out.status = c;
      return this;
    },
    json(b: any) {
      out.body = b;
      return this;
    },
    send(b: any) {
      out.body = b;
      return this;
    },
    redirect(a: any, b?: string) {
      out.status = typeof a === "number" ? a : 302;
      out.location = typeof a === "number" ? b : a;
      return this;
    },
    setHeader() {},
    getHeader() {},
    end() {},
  };
  await handler(
    {
      method,
      headers: {
        host: "console.logs.test",
        "x-real-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1`,
        "content-type": "application/json",
      },
      query: opts.query ?? {},
      body: opts.body,
      cookies: opts.cookies ?? {},
      socket: { remoteAddress: "127.0.0.1" },
      url: "/",
    },
    res
  );
  return out;
}

describe("a CSRF mismatch when creating a session", () => {
  it("answers 401 without writing the cookie jar, the session cookies or the tokens to the logs", async () => {
    const cookies = {
      "fb-csrfToken": "csrf-cookie-VALUE-123",
      "jitsu-auth": "firebase-SESSION-cookie-VALUE-456",
      "oidc-session": "oidc-SESSION-cookie-VALUE-789",
    };
    const r = await call(createSessionRoute, "POST", {
      cookies,
      body: { csrfToken: "other-csrf-VALUE-000", idToken: "id-token-VALUE-111" },
    });
    expect(r.status).toBe(401);
    expect(recorded.lines.some(l => l.startsWith("error") && /CSRF/.test(l))).toBe(true);
    expectNoneOf(
      "csrf-cookie-VALUE-123",
      "firebase-SESSION-cookie-VALUE-456",
      "oidc-SESSION-cookie-VALUE-789",
      "other-csrf-VALUE-000",
      "id-token-VALUE-111"
    );
  });

  it("still tells an operator whether the cookie was missing", async () => {
    await call(createSessionRoute, "POST", { cookies: {}, body: { csrfToken: "x", idToken: "y" } });
    const line = recorded.lines.find(l => /CSRF/.test(l))!;
    expect(line).toMatch(/missing|absent|not present|cookiePresent/i);
  });
});

describe("the signing key derived when JWT_SECRET is empty", () => {
  it("is not written to the logs", async () => {
    vi.stubEnv("JWT_SECRET", "");
    vi.resetModules();
    await import("../../lib/nextauth.config");
    const lines = recorded.lines.filter(l => /autogenerated/i.test(l));
    expect(lines.length, "the fallback was not taken: nothing to check").toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).not.toMatch(/[0-9a-f]{32,}/i);
    }
  });
});

describe("a token that is not a JWT", () => {
  it("is not written to the logs, and not even its start through a parse error", async () => {
    const opaque = "opaqueACCESSvalue.0123456789abcdef";
    expect(isJwtToken(opaque)).toBe(false);
    expect(isJwtToken("not-base64-at-all-!!!")).toBe(false);
    expectNoneOf(
      opaque,
      "opaqueACCESSvalue",
      Buffer.from(opaque.split(".")[0], "base64url").toString("utf8"),
      "not-base64-at-all"
    );
  });

  it("still recognises a JWT", () => {
    expect(isJwtToken(jwt.sign({ a: 1 }, "k"))).toBeTruthy();
  });
});

describe("a database query that fails", () => {
  it("logs the query but none of its parameter values", async () => {
    await expect(
      db.pgHelper().streamQuery("select $1::int as n", ["PARAMETER-secret-VALUE-9"], async () => false)
    ).rejects.toThrow();
    const line = recorded.lines.find(l => /Error executing query/.test(l))!;
    expect(line, "the failure was not logged").toBeDefined();
    expect(line).toContain("select $1::int");
    expectNoneOf("PARAMETER-secret-VALUE-9");
    expect(line).toMatch(/1 param/i);
    // what went wrong stays visible without the value: the SQLSTATE of the failure
    expect(line).toContain("22P02");
  });
});

describe("a database query that succeeds", () => {
  it("is logged with its text and the number of parameters, not their values", async () => {
    const rows: any[] = [];
    await db.pgHelper().streamQuery("select $1::text as v", ["OK-QUERY-secret-VALUE-7"], async r => {
      rows.push(r);
      return false;
    });
    expect(rows).toEqual([{ v: "OK-QUERY-secret-VALUE-7" }]);
    const line = recorded.lines.find(l => /Query executed/.test(l))!;
    expect(line, "the query was not logged").toBeDefined();
    expect(line).toContain("select $1::text");
    expect(line).toMatch(/1 param/i);
    expectNoneOf("OK-QUERY-secret-VALUE-7");
  });
});

describe("a successful OIDC login", () => {
  const IDP = "https://idp.secrets-in-logs.test";

  it("does not write the tokens or the user's claims to the logs", async () => {
    const { workspace } = await seedWorkspace();
    const clientId = `client-${randomId(8)}`;
    const provider = await deps().prisma.oidcProvider.create({
      data: {
        name: "logs",
        issuer: IDP,
        clientId,
        clientSecret: "client-secret-VALUE",
        authorizationEndpoint: `${IDP}/authorize`,
        tokenEndpoint: `${IDP}/token`,
        autoDiscovery: false,
      },
    });
    await deps().prisma.oidcLoginGroup.create({
      data: { workspaceId: workspace.id, oidcProviderId: provider.id, allowAllUsers: true },
    });
    const email = `person-${randomId(6)}@logs.example`.toLowerCase();
    let nonce = "";
    const accessToken = "ACCESS-token-VALUE-abcdef";
    const refreshToken = "REFRESH-token-VALUE-abcdef";
    let idToken = "";
    server.use(
      http.post(`${IDP}/token`, async () => {
        idToken = jwt.sign({ iss: IDP, aud: clientId, sub: "sub-1", email, name: "Private Person", nonce }, "idp-key", {
          expiresIn: "5m",
        });
        return HttpResponse.json({
          access_token: accessToken,
          refresh_token: refreshToken,
          id_token: idToken,
          expires_in: 3600,
        });
      })
    );

    const cookies: Record<string, string> = {};
    const started = await call(authorizeRoute, "GET", { query: { providerId: provider.id }, cookies });
    const url = new URL(started.location!);
    nonce = url.searchParams.get("nonce")!;
    const done = await call(callbackRoute, "GET", {
      query: { code: "code-1", state: url.searchParams.get("state")! },
      cookies,
    });
    expect(done.location).toBe(`/${workspace.slug || workspace.id}`);

    expectNoneOf(
      accessToken,
      refreshToken,
      idToken,
      idToken.split(".")[1],
      email,
      "Private Person",
      "client-secret-VALUE"
    );
    // an operator can still see that a login happened and what the provider returned, without the values
    expect(recorded.lines.some(l => /token/i.test(l) && /info|debug/.test(l))).toBe(true);
  });
});

// keep the unused import of crypto from being flagged by the linter in case the file is trimmed
void crypto;
