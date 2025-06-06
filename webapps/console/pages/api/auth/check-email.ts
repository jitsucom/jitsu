import { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/server/db";
import { z } from "zod";
import { getServerLog } from "../../../lib/server/log";
import { firebase } from "../../../lib/server/firebase-server";

const log = getServerLog("api/auth/check-email");

const CheckEmailRequest = z.object({
  email: z.string().email(),
});

type AuthMethod = {
  type: "firebase-password" | "firebase-google" | "firebase-github" | "oidc" | "none";
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
    const firebaseEnabled = !!process.env.FIREBASE_AUTH;

    if (firebaseEnabled) {
      try {
        const firebaseUser = await firebase().auth().getUserByEmail(email);

        // Check provider data to determine auth method
        if (firebaseUser.providerData && firebaseUser.providerData.length > 0) {
          const providers = firebaseUser.providerData.map(p => p.providerId);

          if (providers.includes("password")) {
            return res.json({ type: "firebase-password" } as AuthMethod);
          } else if (providers.includes("google.com")) {
            return res.json({ type: "firebase-google" } as AuthMethod);
          } else if (providers.includes("github.com")) {
            return res.json({ type: "firebase-github" } as AuthMethod);
          }
        }
      } catch (error: any) {
        // User not found in Firebase, continue to check other methods
        if (error.code !== "auth/user-not-found") {
          log.atError().withCause(error).log("Error checking Firebase user");
        }
      }
    }

    // Check if user exists in database with OIDC
    const userWithOidc = await db.prisma().userProfile.findFirst({
      where: {
        email: email.toLowerCase(),
        loginProvider: {
          startsWith: "oidc:",
        },
      },
      include: {
        workspaceAccess: {
          include: {
            workspace: {
              include: {
                oidcLoginGroups: {
                  include: {
                    oidcProvider: true, // Include OIDC provider details
                  },
                },
              },
            },
          },
        },
      },
    });

    if (userWithOidc && userWithOidc.workspaceAccess.length > 0) {
      const workspaceWithOidc = userWithOidc.workspaceAccess.find(
        wa =>
          wa.workspace.oidcLoginGroups.length > 0 &&
          wa.workspace.oidcLoginGroups.some(group => group.oidcProvider.enabled)
      );
      if (workspaceWithOidc) {
        const oidcGroup = workspaceWithOidc.workspace.oidcLoginGroups.filter(group => group.oidcProvider.enabled)[0];
        return res.json({
          type: "oidc",
          oidcProviderId: oidcGroup.oidcProvider.id,
          oidcProviderName: oidcGroup.oidcProvider.name,
        } as AuthMethod);
      }
    }

    // Check if there's an invitation token for this email
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
          return res.json({
            type: "oidc",
            oidcProviderId: oidcGroup.oidcProvider.id,
            oidcProviderName: oidcGroup.oidcProvider.name,
          } as AuthMethod);
        }
      }
    }

    // No auth method found
    return res.json({ type: "firebase-password" } as AuthMethod);
  } catch (error: any) {
    log.atError().withCause(error).log("Error checking email auth method");
    return res.status(500).json({ error: "Internal server error" });
  }
}
