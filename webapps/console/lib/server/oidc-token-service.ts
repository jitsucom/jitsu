import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import NodeCache from "node-cache";
import { getServerLog } from "./log";
import { db } from "./db";
import { OidcTokens } from "./oidc-types";
import { OidcProviderDbModel } from "../../prisma/schema";
import { z } from "zod";

const log = getServerLog("oidc-token-service");

interface TokenClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  groups?: string[];
  exp: number;
  iat: number;
  iss: string;
  aud: string | string[];
  [key: string]: any;
}

interface TokenIntrospectionResponse {
  active: boolean;
  client_id?: string;
  username?: string;
  scope?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  aud?: string;
  iss?: string;
  token_type?: string;
}

// Cache for JWKS clients with 5-minute TTL
const jwksClientCache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 minutes TTL, check every minute

// Cache for introspection results with 2-minute TTL
const introspectionCache = new NodeCache({ stdTTL: 120, checkperiod: 30 }); // 2 minutes TTL, check every 30 seconds

const oidcProviderCache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 minutes TTL for OIDC provider data

export type OidcProviderDbModel = z.infer<typeof OidcProviderDbModel>;

export async function getOidcProvider(providerId: string): Promise<OidcProviderDbModel | null> {
  const cached = oidcProviderCache.get(providerId);

  if (cached) {
    return cached as OidcProviderDbModel;
  }

  return await db
    .prisma()
    .oidcProvider.findUnique({
      where: { id: providerId, enabled: true },
    })
    .then(provider => {
      if (provider) {
        oidcProviderCache.set(providerId, provider);
      }
      return provider;
    });
}
function getJwksClient(jwksUri: string): jwksClient.JwksClient {
  const cached = jwksClientCache.get<jwksClient.JwksClient>(jwksUri);

  if (cached) {
    return cached;
  }

  const client = jwksClient({
    jwksUri,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 300000, // 5 minutes
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });

  jwksClientCache.set(jwksUri, client);
  return client;
}

export async function validateJwtToken(
  token: string,
  providerId: string
): Promise<{ valid: boolean; claims?: TokenClaims; error?: string }> {
  try {
    const oidcProvider = await getOidcProvider(providerId);

    if (!oidcProvider) {
      return { valid: false, error: "OIDC provider not found" };
    }

    // Decode token header to get key ID
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === "string") {
      return { valid: false, error: "Invalid token format" };
    }

    const { header, payload } = decoded;

    // Get JWKS URI from provider configuration or discovery
    let jwksUri = oidcProvider.jwksUri;
    if (!jwksUri) {
      return { valid: false, error: "JWKS URI not available" };
    }

    // Get signing key
    const client = getJwksClient(jwksUri);
    const key = await client.getSigningKey(header.kid);
    const publicKey = key.getPublicKey();

    // Verify the token
    const claims = jwt.verify(token, publicKey, {
      ...(oidcProvider.audience ? { audience: oidcProvider.audience } : {}),
      issuer: oidcProvider.issuer,
      algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
    }) as TokenClaims;

    return { valid: true, claims };
  } catch (error) {
    log.atWarn().withCause(error).log("JWT validation failed", { providerId });
    return { valid: false, error: error instanceof Error ? error.message : "Token validation failed" };
  }
}

export async function introspectToken(
  token: string,
  providerId: string
): Promise<{ valid: boolean; claims?: TokenIntrospectionResponse; error?: string }> {
  try {
    // Check cache first
    const cacheKey = `${providerId}:${token.substring(0, 16)}`; // Use first 16 chars to avoid storing full token
    const cached = introspectionCache.get<TokenIntrospectionResponse>(cacheKey);

    if (cached) {
      return { valid: cached.active, claims: cached };
    }

    const oidcProvider = await getOidcProvider(providerId);

    if (!oidcProvider) {
      return { valid: false, error: "OIDC provider not found" };
    }

    let introspectionEndpoint = oidcProvider.introspectionEndpoint;
    if (!introspectionEndpoint) {
      return { valid: false, error: "Token introspection endpoint not available" };
    }

    // Perform token introspection
    const response = await fetch(introspectionEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${oidcProvider.clientId}:${oidcProvider.clientSecret}`).toString(
          "base64"
        )}`,
      },
      body: new URLSearchParams({
        token,
        token_type_hint: "access_token",
      }).toString(),
    });

    if (!response.ok) {
      return { valid: false, error: "Token introspection request failed" };
    }

    const result: TokenIntrospectionResponse = await response.json();

    // Cache the result with TTL based on token expiration
    let ttl = 120; // Default 2 minutes
    if (result.exp) {
      const expiresInSeconds = result.exp - Math.floor(Date.now() / 1000);
      if (expiresInSeconds > 0) {
        // Cache until token expires, but with a minimum of 30 seconds and maximum of 300 seconds (5 minutes)
        ttl = Math.max(30, Math.min(300, expiresInSeconds));
      }
    }

    introspectionCache.set(cacheKey, result, ttl);

    return { valid: result.active, claims: result };
  } catch (error) {
    log.atWarn().withCause(error).log("Token introspection failed", { providerId });
    return { valid: false, error: error instanceof Error ? error.message : "Token introspection failed" };
  }
}

export async function refreshAccessToken(
  refreshToken: string,
  providerId: string
): Promise<{ success: boolean; tokens?: OidcTokens; error?: string }> {
  try {
    // Get OIDC provider configuration
    const oidcProvider = await getOidcProvider(providerId);

    if (!oidcProvider) {
      return { success: false, error: "OIDC provider not found" };
    }

    const tokenEndpoint = oidcProvider.tokenEndpoint || `${oidcProvider.issuer}/token`;

    // Refresh the access token
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${oidcProvider.clientId}:${oidcProvider.clientSecret}`).toString(
          "base64"
        )}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: oidcProvider.clientId,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.atWarn().log("Failed to refresh access token", { providerId, error: errorText });
      return { success: false, error: "Token refresh failed" };
    }

    const tokenResponse = await response.json();

    const tokens: OidcTokens = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || refreshToken, // Use new refresh token if provided, otherwise keep the old one
      idToken: tokenResponse.id_token,
      expiresAt: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
    };

    return { success: true, tokens };
  } catch (error) {
    log.atWarn().withCause(error).log("Token refresh failed", { providerId });
    return { success: false, error: error instanceof Error ? error.message : "Token refresh failed" };
  }
}

export function isTokenExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt - 60000; // Consider expired if less than 1 minute remaining
}

export function isJwtToken(token: string): boolean {
  try {
    const header = token.split(".")[0];
    const json = Buffer.from(header, "base64url").toString("utf8");
    const jwtHeader = JSON.parse(json);
    return jwtHeader && jwtHeader.alg;
  } catch (e: any) {
    log.atWarn().withCause(e).log("Failed to decode JWT token", { token });
  }
  return false;
}
