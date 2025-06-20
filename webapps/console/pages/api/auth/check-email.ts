import { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/server/db";
import { z } from "zod";
import { getServerLog } from "../../../lib/server/log";
import { firebase } from "../../../lib/server/firebase-server";
import { credentialsLoginEnabled, githubLoginEnabled, oidcLoginEnabled } from "../../../lib/nextauth.config";
import { isTruish } from "juava";
import { UserProfileDbModel } from "../../../prisma/schema";

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
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { email } = CheckEmailRequest.parse(payload);
    // First, check if Firebase auth is enabled
    const firebaseEnabled = isTruish(process.env.FIREBASE_AUTH);
    const dynamicOidcEnabled = isTruish(process.env.DYNAMIC_OIDC_ENABLED);

    if (firebaseEnabled) {
      const authMethod = await checkFirebaseUser(email);
      if (authMethod) {
        return res.json(authMethod);
      }
    }

    // Check if user exists in database with any login provider
    const existingUser = await db.prisma().userProfile.findFirst({
      where: {
        email: email.toLowerCase(),
      },
    });

    // If user exists, check their login provider
    if (existingUser && !firebaseEnabled) {
      // Check for nextauth login providers
      // TODO: we should replace hardcoded login providers with a dynamic list from nextauth config
      if (["github", "credentials", "oidc"].includes(existingUser.loginProvider)) {
        return res.json({
          type: "nextauth-" + existingUser.loginProvider,
        });
      }
    }

    if (dynamicOidcEnabled) {
      const authMethod = await checkDynamicOidcUser(email, existingUser);
      if (authMethod) {
        return res.json(authMethod);
      }
    }

    // No user found.
    // We don't want to reveal what user email we have registered so offer password login by default for non-existing users
    let defaultType: AuthMethod["type"] = "none";
    if (firebaseEnabled) {
      defaultType = "firebase-password";
    } else if (credentialsLoginEnabled) {
      defaultType = "nextauth-credentials";
    } else if (githubLoginEnabled) {
      defaultType = "nextauth-github";
    } else if (oidcLoginEnabled) {
      defaultType = "nextauth-oidc";
    }

    return res.json({
      type: defaultType,
    });
  } catch (error: any) {
    log.atError().withCause(error).log("Error checking email auth method");
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function checkFirebaseUser(email: string): Promise<AuthMethod | undefined> {
  try {
    const firebaseUser = await firebase().auth().getUserByEmail(email);
    // Check provider data to determine auth method
    if (firebaseUser.providerData && firebaseUser.providerData.length > 0) {
      const providers = firebaseUser.providerData.map(p => p.providerId);
      if (providers.includes("password")) {
        return { type: "firebase-password" };
      } else if (providers.includes("google.com")) {
        return { type: "firebase-google" };
      } else if (providers.includes("github.com")) {
        return { type: "firebase-github" };
      }
    }
  } catch (error: any) {
    // User not found in Firebase, continue to check other methods
    if (error.code !== "auth/user-not-found") {
      log.atError().withCause(error).log("Error checking Firebase user");
    }
  }
}

type UserProfileDbModel = z.infer<typeof UserProfileDbModel>;

async function checkDynamicOidcUser(
  email: string,
  existingUser: UserProfileDbModel | null | undefined
): Promise<AuthMethod | undefined> {
  // Check for dynamic OIDC providers
  const dynamicOidcProviders = await db.prisma().oidcProvider.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
    },
  });
  if (dynamicOidcProviders.length > 0) {
    if (existingUser && existingUser.loginProvider.startsWith("dynamic-oidc/")) {
      const providerId = existingUser.loginProvider.split("/")[1];
      const workspaceAccess = await db.prisma().workspaceAccess.findMany({
        where: {
          userId: existingUser.id,
        },
        include: {
          workspace: {
            include: {
              oidcLoginGroups: {
                where: {
                  oidcProviderId: providerId,
                  oidcProvider: {
                    enabled: true,
                  },
                },
                include: {
                  oidcProvider: true,
                },
              },
            },
          },
        },
      });
      const workspaceWithOidc = workspaceAccess.find(wa => wa.workspace.oidcLoginGroups.length > 0);
      if (workspaceWithOidc) {
        const oidcGroup = workspaceWithOidc.workspace.oidcLoginGroups[0];
        if (oidcGroup) {
          return {
            type: "dynamic-oidc",
            oidcProviderId: oidcGroup.oidcProvider.id,
            oidcProviderName: oidcGroup.oidcProvider.name,
          };
        }
      }
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
          return {
            type: "dynamic-oidc",
            oidcProviderId: oidcGroup.oidcProvider.id,
            oidcProviderName: oidcGroup.oidcProvider.name,
          };
        }
      }
    }
  }
}
