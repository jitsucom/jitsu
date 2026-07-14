import * as crypto from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import type { OAuthClient, Prisma, PrismaClient } from "@prisma/client";
import { checkHash, createHash, hint, randomId } from "juava";
import { z } from "zod";
import { getServerLog } from "../log";
import { getClientIp, getPublicOrigin } from "../origin";
import { getUser } from "../../api";
import type { KvStore } from "../kv";
import { getRateLimiter, setRateLimitHeaders } from "../rate-limit";
import { getServerEnv } from "../serverEnv";
import { OAuthClientsRepo } from "./clients";
import { OAuthCodesRepo } from "./codes";

const log = getServerLog("oauth");

export interface OAuthHandlersDeps {
  prisma: PrismaClient;
  kv: KvStore;
  accessTokenTtlSec: number;
  refreshTokenTtlDays: number;
}

const RegisterBody = z.object({
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
});

const ApproveBody = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal("S256"),
  state: z.string().optional(),
  response_type: z.literal("code"),
});

const DenyBody = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  state: z.string().optional(),
});

// We accept both https: and http: redirect URIs. Restricting http: to loopback
// only (RFC 8252 §8.3) is the ideal, but WHATWG URL returns bracketed IPv6
// hostnames (e.g. "[::1]") making the check fiddly without a dedicated library.
// In practice every MCP client uses a loopback callback anyway, and the real
// security gate is the registered redirect_uri whitelist checked below.
function isSafeRedirectUri(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

const TokenBodyAuthCode = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string(),
  redirect_uri: z.string().url(),
  code_verifier: z.string().min(43).max(128), // PKCE spec range
  client_id: z.string(),
  client_secret: z.string(),
});

const TokenBodyRefresh = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string(), // "<tokenId>:<secret>" format
  client_id: z.string(),
  client_secret: z.string(),
});

const TokenBody = z.discriminatedUnion("grant_type", [TokenBodyAuthCode, TokenBodyRefresh]);

function verifyPkceS256(verifier: string, challenge: string): boolean {
  const hash = crypto.createHash("sha256").update(verifier).digest("base64url");
  return hash === challenge;
}

function jsonError(res: NextApiResponse, status: number, error: string, description?: string) {
  res.status(status).json({ error, ...(description ? { error_description: description } : {}) });
}

// Parses x-www-form-urlencoded or JSON. Next.js parses both into req.body by
// default, but req.body for form-encoded is a Record<string,string>.
function readBody(req: NextApiRequest): Record<string, unknown> {
  return (req.body as Record<string, unknown>) ?? {};
}

export class OAuthHandlers {
  private readonly clients: OAuthClientsRepo;
  private readonly codes: OAuthCodesRepo;

  constructor(private readonly deps: OAuthHandlersDeps) {
    this.clients = new OAuthClientsRepo(deps.prisma);
    this.codes = new OAuthCodesRepo(deps.kv);
  }

  // ─── Discovery: RFC 8414 ────────────────────────────────────────────────
  authServerMetadata = async (_req: NextApiRequest, res: NextApiResponse) => {
    const base = getPublicOrigin();
    res.status(200).json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      scopes_supported: [],
    });
  };

  // ─── Discovery: RFC 9728 (MCP-required) ─────────────────────────────────
  protectedResourceMetadata = async (_req: NextApiRequest, res: NextApiResponse) => {
    const base = getPublicOrigin();
    res.status(200).json({
      resource: base,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
    });
  };

  // ─── DCR: RFC 7591 ──────────────────────────────────────────────────────
  register = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return jsonError(res, 405, "method_not_allowed");

    if (getServerEnv().MINUTE_RATE_LIMIT_ENABLED) {
      const ip = getClientIp(req);
      const rl = await getRateLimiter().check({
        authClass: "ip",
        principal: ip,
        method: "POST",
        bucket: "dcr",
        limit: 200,
        windowMs: 60 * 60_000, // 200 registrations per hour per IP
      });
      setRateLimitHeaders(res, rl);
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(rl.retryAfterSec));
        return jsonError(res, 429, "too_many_requests", "Registration rate limit exceeded. Try again later.");
      }
    }

    const parsed = RegisterBody.safeParse(readBody(req));
    if (!parsed.success) {
      return jsonError(res, 400, "invalid_client_metadata", parsed.error.message);
    }
    // Reject dangerous schemes at registration time so they never enter the
    // whitelist in the first place. Defense in depth — approve/deny also
    // re-check the scheme.
    for (const uri of parsed.data.redirect_uris) {
      if (!isSafeRedirectUri(uri)) {
        return jsonError(res, 400, "invalid_redirect_uri", `unsupported scheme: ${uri}`);
      }
    }
    try {
      const c = await this.clients.register(parsed.data.client_name, parsed.data.redirect_uris);
      // RFC 7591 response shape.
      res.status(201).json({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        client_name: c.name,
        redirect_uris: c.redirectUris,
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    } catch (e: any) {
      log.atWarn().withCause(e).log("DCR failed");
      jsonError(res, 400, "invalid_client_metadata", e.message ?? "registration failed");
    }
  };

  // ─── Authorize approval (called from the consent page) ──────────────────
  // The consent page (pages/oauth/authorize.tsx) renders the UI and, on
  // Approve, POSTs here. We mint a one-shot code and return the redirect URL
  // the page should send the browser to. We don't 302 directly because the
  // page wants to render a brief "Redirecting..." state.
  approve = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return jsonError(res, 405, "method_not_allowed");
    const sessionUser = await getUser(res, req);
    if (!sessionUser) return jsonError(res, 401, "unauthenticated");
    const parsed = ApproveBody.safeParse(readBody(req));
    if (!parsed.success) {
      return jsonError(res, 400, "invalid_request", parsed.error.message);
    }
    const { client_id, redirect_uri, code_challenge, code_challenge_method, state } = parsed.data;
    const target = await this.resolveRedirectTarget(client_id, redirect_uri);
    if ("error" in target) return jsonError(res, 400, target.error, target.description);
    const code = await this.codes.issueCode({
      clientId: target.client.id,
      userId: sessionUser.internalId,
      redirectUri: target.redirectUri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
    });
    const url = new URL(target.redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    res.status(200).json({ redirect_to: url.toString() });
  };

  // Symmetric to approve: same server-side validation, no code issued. The
  // browser used to build this redirect itself from query params — that was
  // an open redirect because nothing checked the redirect_uri was registered
  // for the client. Always route deny through the server.
  deny = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return jsonError(res, 405, "method_not_allowed");
    const parsed = DenyBody.safeParse(readBody(req));
    if (!parsed.success) {
      return jsonError(res, 400, "invalid_request", parsed.error.message);
    }
    const { client_id, redirect_uri, state } = parsed.data;
    const target = await this.resolveRedirectTarget(client_id, redirect_uri);
    if ("error" in target) return jsonError(res, 400, target.error, target.description);
    const url = new URL(target.redirectUri);
    url.searchParams.set("error", "access_denied");
    if (state) url.searchParams.set("state", state);
    res.status(200).json({ redirect_to: url.toString() });
  };

  // Shared validation: client must exist, redirect_uri must be in its
  // registered whitelist, and the scheme must be http/https. Either side
  // (approve, deny) calls this before bouncing the browser anywhere.
  private async resolveRedirectTarget(
    clientId: string,
    redirectUri: string
  ): Promise<
    { client: { id: string; redirectUris: string[] }; redirectUri: string } | { error: string; description: string }
  > {
    if (!isSafeRedirectUri(redirectUri)) {
      return { error: "invalid_request", description: "unsafe redirect_uri scheme" };
    }
    const client = await this.clients.findById(clientId);
    if (!client) return { error: "invalid_client", description: "unknown client_id" };
    if (!client.redirectUris.includes(redirectUri)) {
      return { error: "invalid_request", description: "redirect_uri not registered for this client" };
    }
    return { client, redirectUri };
  }

  // ─── Token endpoint: handles both grants ────────────────────────────────
  token = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return jsonError(res, 405, "method_not_allowed");
    const parsed = TokenBody.safeParse(readBody(req));
    if (!parsed.success) {
      return jsonError(res, 400, "invalid_request", parsed.error.message);
    }
    if (parsed.data.grant_type === "authorization_code") {
      return this.tokenFromCode(parsed.data, res);
    }
    return this.tokenFromRefresh(parsed.data, res);
  };

  private async tokenFromCode(body: z.infer<typeof TokenBodyAuthCode>, res: NextApiResponse): Promise<void> {
    const client = await this.clients.verifyCredentials(body.client_id, body.client_secret);
    if (!client) return jsonError(res, 401, "invalid_client");

    const codePayload = await this.codes.consumeCode(body.code);
    if (!codePayload) return jsonError(res, 400, "invalid_grant", "code expired or already used");
    if (codePayload.clientId !== client.id) {
      return jsonError(res, 400, "invalid_grant", "code does not belong to client");
    }
    if (codePayload.redirectUri !== body.redirect_uri) {
      return jsonError(res, 400, "invalid_grant", "redirect_uri mismatch");
    }
    if (!verifyPkceS256(body.code_verifier, codePayload.codeChallenge)) {
      return jsonError(res, 400, "invalid_grant", "PKCE verification failed");
    }

    // 1:1 enforcement: drop any prior refresh tokens (+ their access tokens)
    // for this user+client. Advisory lock serializes concurrent code exchanges
    // for the same user+client so both can't see prior=[] and both create tokens.
    const issued = await this.deps.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${client.id + ":" + codePayload.userId}))`;
      const prior = await tx.userApiToken.findMany({
        where: { oauthClientId: client.id, userId: codePayload.userId },
        select: { id: true },
      });
      if (prior.length) {
        await tx.oAuthAccessToken.deleteMany({
          where: { refreshTokenId: { in: prior.map(t => t.id) } },
        });
        await tx.userApiToken.deleteMany({ where: { id: { in: prior.map(t => t.id) } } });
      }
      return this.createTokenPair(tx, client, codePayload.userId);
    });

    res.status(200).json(issued);
  }

  private async tokenFromRefresh(body: z.infer<typeof TokenBodyRefresh>, res: NextApiResponse): Promise<void> {
    const client = await this.clients.verifyCredentials(body.client_id, body.client_secret);
    if (!client) return jsonError(res, 401, "invalid_client");

    const [refreshId, refreshSecret] = body.refresh_token.split(":");
    if (!refreshId || !refreshSecret) {
      return jsonError(res, 400, "invalid_grant", "malformed refresh_token");
    }
    const refresh = await this.deps.prisma.userApiToken.findUnique({ where: { id: refreshId } });
    if (!refresh || refresh.oauthClientId !== client.id) {
      return jsonError(res, 400, "invalid_grant", "refresh token unknown for this client");
    }
    if (refresh.expiresAt && refresh.expiresAt.getTime() < Date.now()) {
      return jsonError(res, 400, "invalid_grant", "refresh token expired");
    }
    if (!checkHash(refresh.hash, refreshSecret)) {
      return jsonError(res, 400, "invalid_grant", "refresh token secret mismatch");
    }

    // Rotation: replace the secret on the same row (id stays so /user UI is
    // stable). CAS on the current hash prevents two concurrent rotations both
    // succeeding — the second updateMany sees count=0 and we return null.
    const newRefreshSecret = randomId({ digits: 48, strongRandom: true });
    const newExpiresAt = new Date(Date.now() + this.deps.refreshTokenTtlDays * 86400 * 1000);
    const issued = await this.deps.prisma.$transaction(async tx => {
      const rotated = await tx.userApiToken.updateMany({
        where: { id: refresh.id, hash: refresh.hash },
        data: { hash: createHash(newRefreshSecret), expiresAt: newExpiresAt, lastUsed: new Date() },
      });
      if (rotated.count === 0) return null; // concurrent rotation already consumed this token
      await tx.oAuthAccessToken.deleteMany({ where: { refreshTokenId: refresh.id } });
      const accessSecret = randomId({ digits: 48, strongRandom: true });
      const accessExpires = new Date(Date.now() + this.deps.accessTokenTtlSec * 1000);
      const access = await tx.oAuthAccessToken.create({
        data: { hash: createHash(accessSecret), expiresAt: accessExpires, refreshTokenId: refresh.id },
      });
      return {
        access_token: `${access.id}:${accessSecret}`,
        refresh_token: `${refresh.id}:${newRefreshSecret}`,
        token_type: "Bearer" as const,
        expires_in: this.deps.accessTokenTtlSec,
      };
    });
    if (!issued) return jsonError(res, 400, "invalid_grant", "refresh token already rotated, please retry");
    res.status(200).json(issued);
  }

  // Shared between fresh authorize and (in theory) future grant types.
  private async createTokenPair(tx: Prisma.TransactionClient, client: OAuthClient, userId: string) {
    const refreshSecret = randomId({ digits: 48, strongRandom: true });
    const refreshExpiresAt = new Date(Date.now() + this.deps.refreshTokenTtlDays * 86400 * 1000);
    const refresh = await tx.userApiToken.create({
      data: {
        userId,
        hash: createHash(refreshSecret),
        hint: hint(refreshSecret),
        name: client.name,
        oauthClientId: client.id,
        expiresAt: refreshExpiresAt,
      },
    });
    const accessSecret = randomId({ digits: 48, strongRandom: true });
    const accessExpiresAt = new Date(Date.now() + this.deps.accessTokenTtlSec * 1000);
    const access = await tx.oAuthAccessToken.create({
      data: {
        hash: createHash(accessSecret),
        expiresAt: accessExpiresAt,
        refreshTokenId: refresh.id,
      },
    });
    return {
      access_token: `${access.id}:${accessSecret}`,
      refresh_token: `${refresh.id}:${refreshSecret}`,
      token_type: "Bearer" as const,
      expires_in: this.deps.accessTokenTtlSec,
    };
  }

  // Called from the DELETE /api/user/keys handler for every key delete.
  // For non-MCP tokens (oauthClientId null) this is a plain delete; for MCP
  // tokens it also nukes the access tokens and the OAuthClient row, in the
  // correct order to satisfy FKs. One method = one place to read = one
  // place to update when the model changes.
  deleteUserApiTokenWithMcpCascade = async (refreshTokenId: string): Promise<void> => {
    await this.deps.prisma.$transaction(async tx => {
      const token = await tx.userApiToken.findUnique({
        where: { id: refreshTokenId },
        select: { id: true, oauthClientId: true },
      });
      if (!token) return;
      if (token.oauthClientId) {
        // Order matters: access tokens FK → UserApiToken; UserApiToken FK → OAuthClient.
        await tx.oAuthAccessToken.deleteMany({ where: { refreshTokenId: token.id } });
        await tx.userApiToken.delete({ where: { id: token.id } });
        // Guarded delete: remove the OAuthClient only when no UserApiToken rows
        // still reference it. A plain count-then-delete races with concurrent
        // token issuance, so we use a single DELETE ... WHERE NOT EXISTS to make
        // it atomic. Prisma doesn't support subquery filters, so raw SQL here.
        await tx.$executeRaw`
          DELETE FROM "OAuthClient"
          WHERE id = ${token.oauthClientId}
            AND NOT EXISTS (
              SELECT 1 FROM "UserApiToken"
              WHERE "oauthClientId" = ${token.oauthClientId}
            )`;
      } else {
        await tx.userApiToken.delete({ where: { id: token.id } });
      }
    });
  };
}
