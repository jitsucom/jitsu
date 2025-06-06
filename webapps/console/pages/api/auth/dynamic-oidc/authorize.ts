import { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../../lib/server/db";
import jwt from "jsonwebtoken";
import { getServerLog } from "../../../../lib/server/log";
import { nextAuthConfig } from "../../../../lib/nextauth.config";

const log = getServerLog("api/auth/dynamic-oidc/authorize");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { providerId } = req.query;

  if (!providerId || typeof providerId !== "string") {
    return res.status(400).json({ error: "Provider ID is required" });
  }

  try {
    // Fetch OIDC provider configuration
    const oidcProvider = await db.prisma().oidcProvider.findUnique({
      where: {
        id: providerId,
        enabled: true,
      },
    });

    if (!oidcProvider) {
      return res.status(404).json({ error: "OIDC provider not found or disabled" });
    }

    // Create state token with provider ID using the same secret as NextAuth
    const state = jwt.sign(
      {
        providerId,
        timestamp: Date.now(),
        csrfToken: Math.random().toString(36).substring(2, 15),
      },
      nextAuthConfig.secret as string,
      { expiresIn: "10m" }
    );

    // Construct redirect URI that includes provider ID
    const protocol =
      req.headers["x-forwarded-proto"] ||
      req.headers["x-forwarded-protocol"] ||
      (req.url?.startsWith("https") ? "https" : "http");
    const baseUrl = process.env.NEXTAUTH_URL || process.env.JITSU_PUBLIC_URL || `${protocol}://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/auth/dynamic-oidc/callback`;

    // Get authorization URL
    let authorizationUrl = oidcProvider.authorizationUrl;

    // Handle auto-discovery if needed
    if (oidcProvider.autoDiscovery && !authorizationUrl) {
      try {
        const wellKnownUrl = `${oidcProvider.issuer}/.well-known/openid-configuration`;
        const wellKnownResponse = await fetch(wellKnownUrl);

        if (wellKnownResponse.ok) {
          const discovery = await wellKnownResponse.json();
          authorizationUrl = discovery.authorization_endpoint;

          // Update provider with discovered endpoints
          await db.prisma().oidcProvider.update({
            where: { id: providerId },
            data: {
              authorizationUrl: discovery.authorization_endpoint,
              tokenUrl: discovery.token_endpoint,
              userInfoUrl: discovery.userinfo_endpoint,
              jwksUri: discovery.jwks_uri,
            },
          });
        }
      } catch (error: any) {
        log.atError().withCause(error).log("Failed to fetch OIDC discovery document");
        return res.status(500).json({ error: "Failed to fetch OIDC configuration" });
      }
    }

    if (!authorizationUrl) {
      return res.status(500).json({ error: "Authorization URL not configured" });
    }

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: oidcProvider.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: oidcProvider.scopes.join(" "),
      state: state,
    });

    const authUrl = `${authorizationUrl}?${params.toString()}`;

    // Redirect to OIDC provider
    res.redirect(authUrl);
  } catch (error: any) {
    log.atError().withCause(error).log("Error initiating OIDC authorization");
    return res.status(500).json({ error: "Internal server error" });
  }
}
