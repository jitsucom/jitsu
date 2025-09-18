import { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { getServerLog } from "../../../../lib/server/log";
import { serialize } from "cookie";
import { nextAuthConfig } from "../../../../lib/nextauth.config";
import { refreshAccessToken } from "../../../../lib/server/oidc-token-service";
import { OidcSessionData } from "../../../../lib/server/oidc-types";
import { isSecure } from "../../../../lib/server/origin";

const log = getServerLog("api/auth/renew-oidc");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Check for existing OIDC session cookie
    const oidcSessionCookie = req.cookies?.["oidc-session"];
    if (!oidcSessionCookie) {
      return res.status(401).json({ error: "No OIDC session found" });
    }

    // Verify the current token
    let sessionData: OidcSessionData;

    try {
      sessionData = jwt.verify(oidcSessionCookie, nextAuthConfig.secret as string) as any;
    } catch (err) {
      log.atError().withCause(err).log("Invalid OIDC session token");
      return res.status(401).json({ error: "Invalid session token" });
    }

    let newSessionData = {
      ...sessionData,
      timestamp: Date.now(),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days`
    };

    // If we have tokens and a refresh token, try to refresh the access token
    if (sessionData.tokens && sessionData.tokens.refreshToken && sessionData.providerId) {
      const { refreshToken } = sessionData.tokens;
      log.atInfo().log("Attempting refresh", { userId: sessionData.userId });

      // Attempt to refresh the access token
      const refreshResult = await refreshAccessToken(refreshToken, sessionData.providerId);

      if (refreshResult.success && refreshResult.tokens) {
        log.atInfo().log("Successfully refreshed access token", { userId: sessionData.userId });

        // Update session data with new tokens
        newSessionData.tokens = refreshResult.tokens;
      } else {
        log.atWarn().log("Failed to refresh access token", {
          userId: sessionData.userId,
          error: refreshResult.error,
        });

        // If refresh fails, we can still renew the session without new tokens
        // The calling code will handle token validation and may prompt for re-authentication
      }
    }

    const newSessionToken = jwt.sign(newSessionData, nextAuthConfig.secret as string);

    // Set the renewed cookie
    res.setHeader(
      "Set-Cookie",
      serialize("oidc-session", newSessionToken, {
        httpOnly: true, // Protect from XSS - we'll use a separate mechanism for frontend
        secure: isSecure(req),
        sameSite: "strict", // Strict for better CSRF protection
        maxAge: 7 * 24 * 60 * 60, // 7 days`
        path: "/",
      })
    );

    log.atInfo().log("OIDC session renewed", { email: sessionData.email });

    return res.status(200).json({ success: true, message: "Session renewed" });
  } catch (error: any) {
    log.atError().withCause(error).log("Error renewing OIDC session");
    return res.status(500).json({ error: "Internal server error" });
  }
}
