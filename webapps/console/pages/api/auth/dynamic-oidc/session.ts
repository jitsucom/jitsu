import { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { getServerLog } from "../../../../lib/server/log";
import { nextAuthConfig } from "../../../../lib/nextauth.config";
import {
  validateJwtToken,
  introspectToken,
  isJwtToken,
  isTokenExpired,
} from "../../../../lib/server/oidc-token-service";
import { OidcSessionData } from "../../../../lib/server/oidc-types";

const log = getServerLog("api/auth/oidc-session");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Check for OIDC session cookie
    const oidcSessionCookie = req.cookies?.["oidc-session"];

    if (!oidcSessionCookie) {
      return res.status(200).json({ authenticated: false });
    }

    // Verify the session token
    let sessionData: OidcSessionData;

    try {
      sessionData = jwt.verify(oidcSessionCookie, nextAuthConfig.secret as string) as any;
    } catch (err) {
      log.atError().withCause(err).log("Invalid OIDC session token");
      return res.status(200).json({ authenticated: false });
    }

    // Validate OIDC tokens if present
    if (sessionData.tokens && sessionData.providerId) {
      const { accessToken, expiresAt } = sessionData.tokens;
      // Check if access token is expired
      if (isTokenExpired(expiresAt)) {
        log.atInfo().log("Access token expired, need refresh", { userId: sessionData.userId });
        return res.status(200).json({ authenticated: false, needsRefresh: true });
      }

      // Validate the access token
      let tokenValid = false;

      if (isJwtToken(accessToken)) {
        // Validate JWT token using JWKS
        const validation = await validateJwtToken(accessToken, sessionData.providerId);
        tokenValid = validation.valid;

        if (!tokenValid) {
          log.atWarn().log("JWT token validation failed", {
            userId: sessionData.userId,
            error: validation.error,
          });
        }
      } else {
        // Use token introspection for opaque tokens
        const introspection = await introspectToken(accessToken, sessionData.providerId);
        tokenValid = introspection.valid;

        if (!tokenValid) {
          log.atWarn().log("Token introspection failed", {
            userId: sessionData.userId,
            error: introspection.error,
          });
        }
      }

      if (!tokenValid) {
        log.atWarn().log("OIDC token validation failed", { userId: sessionData.userId });
        return res.status(200).json({ authenticated: false, needsRefresh: true });
      }
    }

    // Return user data (without sensitive information)
    return res.status(200).json({
      authenticated: true,
      user: {
        email: sessionData.email,
        name: sessionData.name,
        internalId: sessionData.userId,
        loginProvider: sessionData.loginProvider,
        externalId: sessionData.externalId,
      },
    });
  } catch (error: any) {
    log.atError().withCause(error).log("Error checking OIDC session");
    return res.status(500).json({ error: "Internal server error" });
  }
}
