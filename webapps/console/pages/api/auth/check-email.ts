import { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/server/db";
import { z } from "zod";
import { getServerLog } from "../../../lib/server/log";
import { firebase } from "../../../lib/server/firebase-server";
import { credentialsLoginEnabled, githubLoginEnabled, oidcLoginEnabled } from "../../../lib/nextauth.config";
import { UserProfileDbModel } from "../../../prisma/schema";
import { getServerEnv } from "../../../lib/server/serverEnv";

const log = getServerLog("api/auth/check-email");

const CheckEmailRequest = z.object({
  email: z.string().email(),
});

type AuthMethod = {
  type:
    | "firebase-password"
    | "firebase-google"
    | "firebase-github"
    | "nextauth-github"
    | "nextauth-credentials"
    | "nextauth-oidc"
    | "dynamic-oidc"
    | "none";
  oidcProviderId?: string;
  oidcProviderName?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authMethods: AuthMethod[] = [];
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { email } = CheckEmailRequest.parse(payload);
    const serverEnv = getServerEnv();
    // First, check if Firebase auth is enabled
    const firebaseEnabled = !!serverEnv.FIREBASE_AUTH;
    const dynamicOidcEnabled = serverEnv.DYNAMIC_OIDC_ENABLED;

    // Check if user exists in database with any login provider
    const existingUsers = await db.prisma().userProfile.findMany({
      where: {
        email: email.toLowerCase(),
      },
    });

    if (dynamicOidcEnabled) {
      authMethods.push(...(await checkDynamicOidcUser(email, existingUsers)));
    }

    if (firebaseEnabled) {
      authMethods.push(...(await checkFirebaseUser(email)));
    } else if (existingUsers.length > 0) {
      // Check for nextauth login providers
      // TODO: we should replace hardcoded login providers with a dynamic list from nextauth config
      for (const existingUser of existingUsers) {
        if (["github", "credentials", "oidc"].includes(existingUser.loginProvider)) {
          authMethods.push({
            type: "nextauth-" + existingUser.loginProvider,
          } as AuthMethod);
        }
      }
    }

    // fallback auth type
    if (firebaseEnabled) {
      authMethods.push({ type: "firebase-google" });
    } else if (credentialsLoginEnabled) {
      authMethods.push({ type: "nextauth-credentials" });
    } else if (githubLoginEnabled) {
      authMethods.push({ type: "nextauth-github" });
    } else if (oidcLoginEnabled) {
      authMethods.push({ type: "nextauth-oidc" });
    } else {
      authMethods.push({ type: "none" });
    }
    //deduplicate auth methods
    const seen = new Set();
    const uniqueAuthMethods = authMethods.filter(am => {
      const key = am.type + (am.oidcProviderId || "");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    return res.json(uniqueAuthMethods);
  } catch (error: any) {
    log.atError().withCause(error).log("Error checking email auth method");
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function checkFirebaseUser(email: string): Promise<AuthMethod[]> {
  try {
    const authMethods: AuthMethod[] = [];
    const firebaseUser = await firebase().auth().getUserByEmail(email);
    // Check provider data to determine auth method
    if (firebaseUser.providerData && firebaseUser.providerData.length > 0) {
      const providers = firebaseUser.providerData.map(p => p.providerId);
      if (providers.includes("password")) {
        authMethods.push({ type: "firebase-password" });
      } else if (providers.includes("google.com")) {
        authMethods.push({ type: "firebase-google" });
      } else if (providers.includes("github.com")) {
        authMethods.push({ type: "firebase-github" });
      }
      return authMethods;
    }
  } catch (error: any) {
    // User not found in Firebase, continue to check other methods
    if (error.code !== "auth/user-not-found") {
      log.atError().withCause(error).log("Error checking Firebase user");
    }
  }
  return [];
}

type UserProfileDbModel = z.infer<typeof UserProfileDbModel>;

async function checkDynamicOidcUser(email: string, existingUsers: UserProfileDbModel[]): Promise<AuthMethod[]> {
  const authMethods: AuthMethod[] = [];
  for (const existingUser of existingUsers) {
    if (existingUser.loginProvider.startsWith("dynamic-oidc/")) {
      const providerId = existingUser.loginProvider.split("/")[1];
      if (providerId) {
        const provider = await db.prisma().oidcProvider.findFirst({
          where: { id: providerId, enabled: true },
          select: { id: true, name: true },
        });
        if (provider) {
          authMethods.push({
            type: "dynamic-oidc",
            oidcProviderId: provider.id,
            oidcProviderName: provider.name,
          });
        }
      }
    }
  }

  // Check for dynamic OIDC providers
  const dynamicOidcProviders = await db.prisma().oidcProvider.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
    },
  });
  if (dynamicOidcProviders.length === 0) {
    return [];
  }
  const invitation = await db.prisma().invitationToken.findFirst({
    where: {
      email: email.toLowerCase(),
      usedBy: null, // Only unused invitations
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  if (invitation) {
    // Check if the workspace has OIDC configured
    const workspace = await db.prisma().workspace.findUnique({
      where: {
        id: invitation.workspaceId,
      },
      include: {
        oidcLoginGroups: {
          include: {
            oidcProvider: true,
          },
        },
      },
    });
    if (workspace && workspace.oidcLoginGroups.length > 0) {
      const oidcGroup = workspace.oidcLoginGroups.find(group => group.oidcProvider.enabled);
      if (oidcGroup) {
        authMethods.push({
          type: "dynamic-oidc",
          oidcProviderId: oidcGroup.oidcProvider.id,
          oidcProviderName: oidcGroup.oidcProvider.name,
        });
      }
    }
  }
  return authMethods;
}
