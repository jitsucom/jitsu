import type { NextApiRequest, NextApiResponse } from "next";
import type { PrismaClient } from "@prisma/client";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { checkHash } from "juava";
import { getServerLog } from "../log";
import { getPublicOrigin } from "../origin";
import { type FireAndForget, detachedPromise } from "../kv";

const log = getServerLog("mcp-auth");

function bearer(req: NextApiRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const [scheme, token] = h.split(" ", 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

// Mints a 401 response that points the client at our OAuth metadata
// (per MCP / RFC 9728). Without this header, MCP clients won't know how
// to start the OAuth flow.
function send401(res: NextApiResponse, error: string, description: string) {
  const base = getPublicOrigin();
  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="jitsu-mcp", error="${error}", error_description="${description}", resource_metadata="${base}/.well-known/oauth-protected-resource"`
  );
  res.status(401).json({ error, error_description: description });
}

export class AuthChecker {
  constructor(private readonly prisma: PrismaClient, private readonly schedule: FireAndForget = detachedPromise) {}

  async requireAccessToken(req: NextApiRequest, res: NextApiResponse): Promise<AuthInfo | undefined> {
    const raw = bearer(req);
    if (!raw) {
      send401(res, "missing_token", "Authorization header either missing or malformed");
      return undefined;
    }
    const [tokenId, secret] = raw.split(":");
    if (!tokenId || !secret) {
      send401(res, "invalid_token", "Token format must be tokenId:secret");
      return undefined;
    }
    // Two auth paths share the `keyId:secret` bearer shape. The OAuth path
    // (interactive clients) is the hot one, so try it first; on a miss, fall
    // back to a personal API key — the same key the management REST API accepts,
    // for CI / headless where the browser OAuth flow can't run.
    const oauth = await this.fromOAuthAccessToken(res, raw, tokenId, secret);
    if (oauth) return oauth;
    // A found-but-invalid OAuth token (bad secret / expired) already sent its
    // 401; only fall through to the API-key path when the id simply wasn't an
    // OAuth access token.
    if (res.headersSent) return undefined;
    return this.fromApiKey(res, raw, tokenId, secret);
  }

  // OAuth path: short-lived OAuthAccessToken minted via the authorize flow.
  // Returns undefined (without sending a response) when no such token exists,
  // so the caller can try the API-key path. A found-but-invalid token (bad
  // secret / expired) sends its own 401 and returns undefined.
  private async fromOAuthAccessToken(
    res: NextApiResponse,
    raw: string,
    tokenId: string,
    secret: string
  ): Promise<AuthInfo | undefined> {
    const at = await this.prisma.oAuthAccessToken.findUnique({
      where: { id: tokenId },
      include: { refreshToken: { include: { user: true, oauthClient: true } } },
    });
    if (!at) return undefined;
    if (!checkHash(at.hash, secret)) {
      send401(res, "invalid_token", "Access token secret mismatch");
      return undefined;
    }
    if (at.expiresAt.getTime() < Date.now()) {
      send401(res, "expired_token", "Access token has expired");
      return undefined;
    }
    this.schedule(async () => {
      const now = new Date();
      await this.prisma.oAuthAccessToken
        .update({ where: { id: at.id }, data: { lastUsed: now } })
        .catch(e => log.atWarn().withCause(e).log("Failed to bump OAuthAccessToken.lastUsed"));
      await this.prisma.userApiToken
        .update({ where: { id: at.refreshTokenId }, data: { lastUsed: now } })
        .catch(e => log.atWarn().withCause(e).log("Failed to bump UserApiToken.lastUsed"));
    });

    const user = at.refreshToken.user;
    return {
      token: raw,
      clientId: at.refreshToken.oauthClientId ?? "unknown",
      scopes: [],
      expiresAt: Math.floor(at.expiresAt.getTime() / 1000),
      extra: {
        userId: user.id,
        email: user.email,
        name: user.name,
        // Carried so tools can build a SessionUser for verifyAccess / audit-log
        // without re-querying UserProfile, and so config-object audit rows are
        // attributed to the MCP token (refreshTokenId) and login identity.
        externalId: user.externalId,
        loginProvider: user.loginProvider,
        refreshTokenId: at.refreshTokenId,
        clientName: at.refreshToken.oauthClient?.name,
      },
    };
  }

  // API-key path: a personal UserApiToken (oauthClientId IS NULL), the same key
  // type the management REST API accepts (see lib/api.ts). Always sends a 401 on
  // failure — it's the last path tried, so an unknown id here means the whole
  // bearer is invalid.
  private async fromApiKey(
    res: NextApiResponse,
    raw: string,
    tokenId: string,
    secret: string
  ): Promise<AuthInfo | undefined> {
    const token = await this.prisma.userApiToken.findUnique({
      where: { id: tokenId },
      include: { user: true },
    });
    if (!token) {
      send401(res, "invalid_token", "Access token not found");
      return undefined;
    }
    // Verify the secret before branching on the token's kind, so a bad secret
    // returns the same error for every id — without this, the oauthClientId
    // check below would be a token-type oracle for callers who don't hold the
    // secret. Matches the check order in lib/api.ts for the REST API.
    if (!checkHash(token.hash, secret)) {
      send401(res, "invalid_token", "Access token secret mismatch");
      return undefined;
    }
    // OAuth refresh tokens live in UserApiToken too, but must not be usable as
    // MCP bearer keys — symmetric to the rejection in lib/api.ts for the REST API.
    if (token.oauthClientId) {
      send401(res, "invalid_token", "OAuth refresh tokens cannot be used as MCP API keys");
      return undefined;
    }
    if (token.expiresAt && token.expiresAt.getTime() < Date.now()) {
      send401(res, "expired_token", "API key has expired");
      return undefined;
    }
    this.schedule(async () => {
      await this.prisma.userApiToken
        .update({ where: { id: token.id }, data: { lastUsed: new Date() } })
        .catch(e => log.atWarn().withCause(e).log("Failed to bump UserApiToken.lastUsed"));
    });

    const user = token.user;
    return {
      token: raw,
      clientId: "api-key",
      scopes: [],
      // No server-side expiry for a non-expiring key; carry the row's expiry if set.
      expiresAt: token.expiresAt ? Math.floor(token.expiresAt.getTime() / 1000) : undefined,
      extra: {
        userId: user.id,
        email: user.email,
        name: user.name,
        externalId: user.externalId,
        loginProvider: user.loginProvider,
        // Attribute audit rows to the API key itself (no OAuth refresh token here).
        refreshTokenId: token.id,
        clientName: token.name ?? undefined,
      },
    };
  }
}
