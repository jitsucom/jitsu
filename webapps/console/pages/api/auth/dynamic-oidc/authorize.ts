import { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { getServerLog } from "../../../../lib/server/log";
import { nextAuthConfig } from "../../../../lib/nextauth.config";
import crypto from "crypto";
import { extractReturnUrl } from "../../../../lib/auth-redirect";
import { getOidcProvider } from "../../../../lib/server/oidc-token-service";
import { performAutoDiscovery } from "../../../../lib/server/oidc-discovery";

const log = getServerLog("api/auth/dynamic-oidc/authorize");

// Helper function to generate PKCE challenge
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { providerId, loginHint } = req.query;

  if (!providerId || typeof providerId !== "string") {
    return res.status(400).json({ error: "Provider ID is required" });
  }

  try {
    // Fetch OIDC provider configuration
    const oidcProvider = await getOidcProvider(providerId);

    if (!oidcProvider) {
      return res.status(404).json({ error: "OIDC provider not found or disabled" });
    }

    // Generate PKCE challenge
    const pkce = generatePKCE();

    // Generate secure nonce for ID token validation
    const nonce = crypto.randomBytes(16).toString("hex");

    // Extract return URL from request for post-auth redirect
    const returnUrl = extractReturnUrl(req);

    // Create state token with provider ID, PKCE verifier, return URL, and additional security data
    const state = jwt.sign(
      {
        providerId,
        timestamp: Date.now(),
        csrfToken: crypto.randomBytes(16).toString("hex"),
        codeVerifier: pkce.codeVerifier,
        nonce,
        returnUrl, // Include return URL in state
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
    let authorizationEndpoint = oidcProvider.authorizationEndpoint;

    // Handle auto-discovery if needed
    if (!authorizationEndpoint) {
      const discovery = await performAutoDiscovery(oidcProvider);
      if (discovery) {
        authorizationEndpoint = discovery.authorization_endpoint;
      }
    }

    if (!authorizationEndpoint) {
      return res.status(500).json({ error: "Authorization endpoint not configured" });
    }

    // Build authorization URL with PKCE and security parameters
    const params = new URLSearchParams({
      client_id: oidcProvider.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: oidcProvider.scopes.join(" "),
      state: state,
      // Use audience from provider config if set
      ...(oidcProvider.audience ? { audience: oidcProvider.audience } : {}),
      // PKCE parameters
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
      // Additional security parameters
      nonce: nonce,
      // Use prompt from provider config, default to "login" for security
      prompt: oidcProvider.prompt || "login",
      ...(loginHint ? { login_hint: loginHint as string } : {}),
    });

    const authUrl = `${authorizationEndpoint}?${params.toString()}`;

    // Redirect to OIDC provider
    res.redirect(authUrl);
  } catch (error: any) {
    log.atError().withCause(error).log("Error initiating OIDC authorization");
    return res.status(500).json({ error: "Internal server error" });
  }
}
