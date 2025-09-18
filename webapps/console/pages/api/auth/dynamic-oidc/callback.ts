import { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../../lib/server/db";
import jwt from "jsonwebtoken";
import { getOrCreateUser, nextAuthConfig } from "../../../../lib/nextauth.config";
import { getServerLog } from "../../../../lib/server/log";
import { serialize } from "cookie";
import { validateReturnUrl } from "../../../../lib/auth-redirect";
import { OidcTokenResponse, OidcUserInfo, OidcSessionData } from "../../../../lib/server/oidc-types";
import { getOidcProvider } from "../../../../lib/server/oidc-token-service";
import { isSecure } from "../../../../lib/server/origin";
import { redirectWithOidcError, OidcErrors } from "../../../../lib/server/oidc-error-handler";

const log = getServerLog("api/auth/dynamic-oidc/callback");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, state, error } = req.query;

  if (error) {
    log.atError().log(`OIDC authorization error: ${error}`);
    return redirectWithOidcError(res, {
      error: OidcErrors.AUTH_ERROR,
      message: error as string,
    });
  }

  if (!code || !state) {
    return redirectWithOidcError(res, {
      error: OidcErrors.MISSING_PARAMS,
    });
  }
  let stateData: any = undefined;
  try {
    // Verify and decode state using the same secret as NextAuth
    try {
      stateData = jwt.verify(state as string, nextAuthConfig.secret as string) as any;
    } catch (err) {
      log.atError().withCause(err).log("Invalid state token");
      return redirectWithOidcError(res, {
        error: OidcErrors.INVALID_STATE,
      });
    }

    // Check if state is not too old (10 minutes)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return redirectWithOidcError(res, {
        error: OidcErrors.STATE_EXPIRED,
        returnUrl: stateData.returnUrl,
      });
    }

    // Fetch OIDC provider configuration
    const oidcProvider = await getOidcProvider(stateData.providerId);

    if (!oidcProvider) {
      return redirectWithOidcError(res, {
        error: OidcErrors.PROVIDER_NOT_FOUND,
        returnUrl: stateData.returnUrl,
      });
    }

    // Exchange code for tokens
    const tokenEndpoint = oidcProvider.tokenEndpoint || `${oidcProvider.issuer}/token`;
    const protocol =
      req.headers["x-forwarded-proto"] ||
      req.headers["x-forwarded-protocol"] ||
      (req.url?.startsWith("https") ? "https" : "http");
    const baseUrl = process.env.NEXTAUTH_URL || process.env.JITSU_PUBLIC || `${protocol}://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/auth/dynamic-oidc/callback`;

    // Build token request parameters
    const tokenParams: Record<string, string> = {
      grant_type: "authorization_code",
      code: code as string,
      redirect_uri: redirectUri,
      client_id: oidcProvider.clientId,
    };

    // Add audience if configured
    if (oidcProvider.audience) {
      tokenParams.audience = oidcProvider.audience;
    }

    // Add PKCE verifier if present
    if (stateData.codeVerifier) {
      tokenParams.code_verifier = stateData.codeVerifier;
    }

    const tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${oidcProvider.clientId}:${oidcProvider.clientSecret}`).toString(
          "base64"
        )}`,
      },
      body: new URLSearchParams(tokenParams).toString(),
    });
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      log.atError().log(`Failed to exchange code for tokens: ${errorText}`);
      return redirectWithOidcError(res, {
        error: OidcErrors.TOKEN_EXCHANGE_FAILED,
        returnUrl: stateData.returnUrl,
      });
    }

    const tokens: OidcTokenResponse = await tokenResponse.json();
    log.atInfo().log("Exchanging code for tokens", tokens);
    // Get user info
    let userInfo: OidcUserInfo;

    if (tokens.id_token) {
      // Decode and validate ID token
      const decoded = jwt.decode(tokens.id_token, { complete: true }) as any;

      if (!decoded) {
        log.atError().log("Failed to decode ID token");
        return redirectWithOidcError(res, {
          error: OidcErrors.INVALID_ID_TOKEN,
          returnUrl: stateData.returnUrl,
        });
      }

      // Validate token claims
      const payload = decoded.payload;

      // Check issuer
      if (payload.iss !== oidcProvider.issuer) {
        log.atError().log(`Invalid issuer: ${payload.iss} !== ${oidcProvider.issuer}`);
        return redirectWithOidcError(res, {
          error: OidcErrors.INVALID_ISSUER,
          returnUrl: stateData.returnUrl,
        });
      }

      // Check audience
      if (payload.aud !== oidcProvider.clientId && !payload.aud?.includes(oidcProvider.clientId)) {
        log.atError().log(`Invalid audience: ${payload.aud}`);
        return redirectWithOidcError(res, {
          error: OidcErrors.INVALID_AUDIENCE,
          returnUrl: stateData.returnUrl,
        });
      }

      // Check nonce if present in state
      if (stateData.nonce && payload.nonce !== stateData.nonce) {
        log.atError().log(`Invalid nonce: ${payload.nonce} !== ${stateData.nonce}`);
        return redirectWithOidcError(res, {
          error: OidcErrors.INVALID_NONCE,
          returnUrl: stateData.returnUrl,
        });
      }

      // Check token expiration
      if (payload.exp && payload.exp < Date.now() / 1000) {
        log.atError().log("ID token has expired");
        return redirectWithOidcError(res, {
          error: OidcErrors.TOKEN_EXPIRED,
          returnUrl: stateData.returnUrl,
        });
      }

      userInfo = payload;
    } else if (oidcProvider.userinfoEndpoint) {
      // Fetch from userinfo endpoint
      const userInfoResponse = await fetch(oidcProvider.userinfoEndpoint, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userInfoResponse.ok) {
        log.atError().log("Failed to fetch user info");
        return redirectWithOidcError(res, {
          error: OidcErrors.USERINFO_FETCH_FAILED,
          returnUrl: stateData.returnUrl,
        });
      }

      userInfo = await userInfoResponse.json();
    } else {
      log.atError().log("No ID token or userinfo endpoint available");
      return redirectWithOidcError(res, {
        error: OidcErrors.NO_USER_INFO,
        returnUrl: stateData.returnUrl,
      });
    }

    // Extract user details based on claim mappings
    const email = userInfo[oidcProvider.emailClaim] || userInfo.email;
    const name = userInfo[oidcProvider.nameClaim] || userInfo.name || userInfo.preferred_username || email;
    const groups = userInfo[oidcProvider.groupClaim || "groups"] || [];

    if (!email) {
      log.atError().log("No email found in OIDC response");
      return redirectWithOidcError(res, {
        error: OidcErrors.NO_EMAIL,
        returnUrl: stateData.returnUrl,
      });
    }

    // Check if user has access to any workspace via OidcLoginGroup
    const oidcLoginGroups = await db.prisma().oidcLoginGroup.findMany({
      where: {
        oidcProviderId: stateData.providerId,
      },
      include: {
        workspace: true,
      },
    });

    // Filter workspaces the user has access to
    const accessibleWorkspaces = oidcLoginGroups.filter(group => {
      if (group.allowAllUsers) {
        return true;
      }

      if (group.groupValue && Array.isArray(groups)) {
        return groups.includes(group.groupValue);
      }

      return false;
    });

    if (accessibleWorkspaces.length === 0) {
      log.atWarn().log(`User ${email} has no access to any workspace`);
      return redirectWithOidcError(res, {
        error: OidcErrors.NO_WORKSPACE_ACCESS,
        returnUrl: stateData.returnUrl,
      });
    }

    // Create or update user
    const user = await getOrCreateUser({
      externalId: userInfo.sub,
      loginProvider: `dynamic-oidc/${stateData.providerId}`,
      email: email.toLowerCase(),
      name: name,
      req: req,
    });

    // Create OIDC session data with tokens
    const sessionData: OidcSessionData = {
      userId: user.id,
      email: user.email,
      name: user.name,
      loginProvider: user.loginProvider,
      externalId: user.externalId,
      providerId: stateData.providerId,
      timestamp: Date.now(),
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
      },
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days`
    };

    // Create session token
    const sessionToken = jwt.sign(sessionData, nextAuthConfig.secret as string);

    // Set secure session cookie
    res.setHeader(
      "Set-Cookie",
      serialize("oidc-session", sessionToken, {
        httpOnly: true,
        secure: isSecure(req),
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60, // 7 days`
        path: "/",
      })
    );

    // Determine where to redirect after successful authentication
    let redirectUrl = stateData.returnUrl;
    // Validate the return URL for security
    if (redirectUrl) {
      redirectUrl = validateReturnUrl(redirectUrl);
    }

    // If no valid return URL, redirect to the user's first accessible workspace
    if (!redirectUrl) {
      const workspace = accessibleWorkspaces[0].workspace;
      redirectUrl = `/${workspace.slug || workspace.id}`;
    }

    res.redirect(redirectUrl);
  } catch (error: any) {
    log.atError().withCause(error).log("Error handling OIDC callback");
    return redirectWithOidcError(res, {
      error: OidcErrors.INTERNAL_ERROR,
      returnUrl: stateData?.returnUrl,
    });
  }
}
