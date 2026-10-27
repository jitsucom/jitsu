import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { createHash, randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { AuthChecker } from "../../lib/server/mcp-server/auth";
import { OAuthHandlers } from "../../lib/server/mcp-server/oauth";
import { verifyAccessWithRole } from "../../lib/api";

// JITSU-265: an MCP client got the full account. Read-only approval gives its tokens the analyst role.

function memoryKv(): any {
  const m = new Map<string, any>();
  return {
    get: async (k: string) => m.get(k),
    set: async (k: string, v: any) => (m.set(k, v), true),
    del: async (k: string) => m.delete(k),
    getDel: async (k: string) => {
      const v = m.get(k);
      m.delete(k);
      return v;
    },
    scanByPrefix: async () => [],
  };
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, any>,
    setHeader(n: string, v: any) {
      this.headers[n] = v;
    },
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
  };
  return res;
}

const req = (body: any, headers: Record<string, string> = {}) =>
  ({ method: "POST", headers, socket: {}, query: {}, cookies: {}, body } as any);

async function connect(readOnly: boolean) {
  const { user, workspace } = await seedWorkspace(); // owner of the workspace
  const secret = randomId(24);
  const key = await deps().prisma.userApiToken.create({
    data: { hint: "x***", hash: createHash(secret), userId: user.internalId },
  });
  const sessionHeaders = { authorization: `Bearer ${key.id}:${secret}` };
  const handlers = new OAuthHandlers({
    prisma: deps().prisma,
    kv: memoryKv(),
    accessTokenTtlSec: 3600,
    refreshTokenTtlDays: 30,
  });

  const redirect = "https://client.example/callback";
  const registered = makeRes();
  await handlers.register(req({ client_name: "Some client", redirect_uris: [redirect] }), registered);
  const { client_id, client_secret } = registered.body;

  const verifier = randomId({ digits: 64, strongRandom: true });
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const approved = makeRes();
  await handlers.approve(
    req(
      {
        client_id,
        redirect_uri: redirect,
        code_challenge: challenge,
        code_challenge_method: "S256",
        response_type: "code",
        ...(readOnly ? { read_only: true } : {}),
      },
      sessionHeaders
    ),
    approved
  );
  expect(approved.statusCode).toBe(200);
  const code = new URL(approved.body.redirect_to).searchParams.get("code")!;

  const tokens = makeRes();
  await handlers.token(
    req({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
      client_id,
      client_secret,
    }),
    tokens
  );
  expect(tokens.statusCode).toBe(200);

  const auth = await new AuthChecker(deps().prisma, () => {}).requireAccessToken(
    { headers: { authorization: `Bearer ${tokens.body.access_token}` } } as any,
    makeRes()
  );
  return { auth: auth!, user, workspace, handlers, tokens: tokens.body, client_id, client_secret };
}

const asMcpUser = (auth: any, user: any) => ({
  ...user,
  authType: "mcp",
  tokenRole: auth.extra.role,
  tokenWorkspaceId: auth.extra.workspaceId,
});

describe("MCP read-only approval", () => {
  it("gives the tokens the analyst role, which cannot change anything", async () => {
    const { auth, user, workspace } = await connect(true);
    expect(auth.extra!.role).toBe("analyst");
    const mcpUser = asMcpUser(auth, user);
    await expect(verifyAccessWithRole(mcpUser, workspace.id, "readEntities")).resolves.toBeDefined();
    await expect(verifyAccessWithRole(mcpUser, workspace.id, "editEntities")).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessWithRole(mcpUser, workspace.id, "deleteEntities")).rejects.toMatchObject({ status: 403 });
  });

  it("keeps the role when the refresh token is used", async () => {
    const { handlers, tokens, client_id, client_secret } = await connect(true);
    const refreshed = makeRes();
    await handlers.token(
      req({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id, client_secret }),
      refreshed
    );
    expect(refreshed.statusCode).toBe(200);
    const auth = await new AuthChecker(deps().prisma, () => {}).requireAccessToken(
      { headers: { authorization: `Bearer ${refreshed.body.access_token}` } } as any,
      makeRes()
    );
    expect(auth!.extra!.role).toBe("analyst");
  });

  it("without the read-only choice nothing changes", async () => {
    const { auth, user, workspace } = await connect(false);
    expect(auth.extra!.role).toBeNull();
    await expect(verifyAccessWithRole(asMcpUser(auth, user), workspace.id, "editEntities")).resolves.toBeDefined();
  });
});
