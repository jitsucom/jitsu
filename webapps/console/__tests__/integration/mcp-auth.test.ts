import { describe, expect, it } from "vitest";
import { createHash } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { AuthChecker } from "../../lib/server/mcp-server/auth";

// No origin stub: send401 builds the WWW-Authenticate metadata URL from
// getPublicOrigin(), which reads JITSU_PUBLIC_URL at call time — the harness
// baseline env (http://console.test.local) covers it. Token rows are real
// UserApiToken records in the per-file database.

const noopSchedule = (_fn: () => Promise<any>) => {};

function makeReq(authorization: string) {
  return { headers: { authorization } } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, any>,
    setHeader(name: string, value: any) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function seedApiKey(opts: { secret: string; oauthClientId?: string }) {
  const { prisma } = deps();
  const { user } = await seedWorkspace();
  let oauthClientId: string | undefined;
  if (opts.oauthClientId) {
    const client = await prisma.oAuthClient.create({
      data: { clientSecretHash: createHash("client-secret"), name: "test client", redirectUris: [] },
    });
    oauthClientId = client.id;
  }
  const token = await prisma.userApiToken.create({
    data: {
      hint: opts.secret.slice(0, 3) + "***",
      hash: createHash(opts.secret),
      userId: user.internalId,
      ...(oauthClientId ? { oauthClientId } : {}),
    },
  });
  return { token, user };
}

describe("AuthChecker: MCP auth via personal API key", () => {
  it("authenticates a personal key (oauthClientId null)", async () => {
    const secret = "keysecret";
    const { token, user } = await seedApiKey({ secret });
    const auth = await new AuthChecker(deps().prisma, noopSchedule).requireAccessToken(
      makeReq(`Bearer ${token.id}:${secret}`),
      makeRes()
    );
    expect(auth?.extra?.userId).toBe(user.internalId);
    expect(auth?.clientId).toBe("api-key");
  });

  it("rejects an OAuth refresh token (oauthClientId set) presented as a key", async () => {
    const secret = "refreshsecret";
    const { token } = await seedApiKey({ secret, oauthClientId: "yes" });
    const res = makeRes();
    const auth = await new AuthChecker(deps().prisma, noopSchedule).requireAccessToken(
      makeReq(`Bearer ${token.id}:${secret}`),
      res
    );
    expect(auth).toBeUndefined();
    expect(res.statusCode).toBe(401);
    // the metadata URL in WWW-Authenticate derives from the real env-driven origin
    expect(String(res.headers["WWW-Authenticate"] ?? "")).toContain("console.test.local");
  });

  it("rejects a wrong secret for an existing key", async () => {
    const { token } = await seedApiKey({ secret: "rightsecret" });
    const res = makeRes();
    const auth = await new AuthChecker(deps().prisma, noopSchedule).requireAccessToken(
      makeReq(`Bearer ${token.id}:wrongsecret`),
      res
    );
    expect(auth).toBeUndefined();
    expect(res.statusCode).toBe(401);
  });
});
