import { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../../lib/server/db";
import jwt from "jsonwebtoken";
import { getOrCreateUser, nextAuthConfig } from "../../../../lib/nextauth.config";
import { getServerLog } from "../../../../lib/server/log";

const log = getServerLog("api/auth/dynamic-oidc/callback");

interface OidcTokenResponse {
  access_token: string;
  token_type: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface OidcUserInfo {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  groups?: string[];
  [key: string]: any;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, state, error } = req.query;

  if (error) {
    log.atError().log(`OIDC authorization error: ${error}`);
    return res.redirect(`/?error=oidc_auth_error&message=${encodeURIComponent(error as string)}`);
  }

  if (!code || !state) {
    return res.redirect("/?error=missing_params");
  }

  try {
    // Verify and decode state using the same secret as NextAuth
    let stateData: { providerId: string; timestamp: number; csrfToken: string };
    try {
      stateData = jwt.verify(state as string, nextAuthConfig.secret as string) as any;
    } catch (err) {
      log.atError().withCause(err).log("Invalid state token");
      return res.redirect("/?error=invalid_state");
    }

    // Check if state is not too old (10 minutes)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return res.redirect("/?error=state_expired");
    }

    // Fetch OIDC provider configuration
    const oidcProvider = await db.prisma().oidcProvider.findUnique({
      where: {
        id: stateData.providerId,
        enabled: true,
      },
    });

    if (!oidcProvider) {
      return res.redirect("/?error=provider_not_found");
    }

    // Exchange code for tokens
    const tokenUrl = oidcProvider.tokenUrl || `${oidcProvider.issuer}/token`;
    const protocol =
      req.headers["x-forwarded-proto"] ||
      req.headers["x-forwarded-protocol"] ||
      (req.url?.startsWith("https") ? "https" : "http");
    const baseUrl = process.env.NEXTAUTH_URL || process.env.JITSU_PUBLIC || `${protocol}://${req.headers.host}`;
    const redirectUri = `${baseUrl}/api/auth/dynamic-oidc/callback`;

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${oidcProvider.clientId}:${oidcProvider.clientSecret}`).toString(
          "base64"
        )}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: redirectUri,
        client_id: oidcProvider.clientId,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      log.atError().log(`Failed to exchange code for tokens: ${errorText}`);
      return res.redirect("/?error=token_exchange_failed");
    }

    const tokens: OidcTokenResponse = await tokenResponse.json();

    // Get user info
    let userInfo: OidcUserInfo;

    if (tokens.id_token) {
      // Decode ID token (in production, verify the signature against JWKS)
      const decoded = jwt.decode(tokens.id_token) as OidcUserInfo;
      userInfo = decoded;
    } else if (oidcProvider.userInfoUrl) {
      // Fetch from userinfo endpoint
      const userInfoResponse = await fetch(oidcProvider.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userInfoResponse.ok) {
        log.atError().log("Failed to fetch user info");
        return res.redirect("/?error=userinfo_fetch_failed");
      }

      userInfo = await userInfoResponse.json();
    } else {
      log.atError().log("No ID token or userinfo endpoint available");
      return res.redirect("/?error=no_user_info");
    }

    // Extract user details based on claim mappings
    const email = userInfo[oidcProvider.emailClaim] || userInfo.email;
    const name = userInfo[oidcProvider.nameClaim] || userInfo.name || userInfo.preferred_username || email;
    const groups = userInfo[oidcProvider.groupClaim || "groups"] || [];

    if (!email) {
      log.atError().log("No email found in OIDC response");
      return res.redirect("/?error=no_email");
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
      return res.redirect("/?error=no_workspace_access");
    }

    // Create or update user
    const user = await getOrCreateUser({
      externalId: userInfo.sub,
      loginProvider: `oidc:${stateData.providerId}`,
      email: email.toLowerCase(),
      name: name,
      req: req,
    });

    // Grant access to workspaces
    for (const group of accessibleWorkspaces) {
      await db.prisma().workspaceAccess.upsert({
        where: {
          userId_workspaceId: {
            userId: user.id,
            workspaceId: group.workspaceId,
          },
        },
        create: {
          userId: user.id,
          workspaceId: group.workspaceId,
        },
        update: {},
      });
    }

    // For NextAuth environments, we need to create a session
    // This is a bit tricky since NextAuth expects to handle the full OAuth flow
    // One approach is to redirect to a special page that triggers NextAuth signin

    // Create a temporary token to pass user info using the same secret as NextAuth
    const tempToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        loginProvider: user.loginProvider,
        externalId: user.externalId,
      },
      nextAuthConfig.secret as string,
      { expiresIn: "1m" }
    );

    // Redirect to a page that will complete the signin
    const workspace = accessibleWorkspaces[0].workspace;
    res.redirect(`/api/auth/complete-oidc?token=${tempToken}&workspace=${workspace.slug || workspace.id}`);
  } catch (error: any) {
    log.atError().withCause(error).log("Error handling OIDC callback");
    return res.redirect("/?error=internal_error");
  }
}
