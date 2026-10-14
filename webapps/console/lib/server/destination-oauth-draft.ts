import cuid from "cuid";
import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../shared/errors";
import { assertModelsEnabled } from "./reverse-etl-models";
import { destinationAccountsForConfig } from "./destination-accounts";
import type { NangoConfig } from "./oauth/nango-config";
import { AccountDiscoveryProvider, accountDiscoveryIntegrations } from "../schema/destination-accounts";

const claims = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  destinationId: z.string(),
  destinationType: AccountDiscoveryProvider,
  oauthIntegrationId: z.string(),
});
const signing = {
  algorithm: "HS256",
  issuer: "jitsu-destination-draft",
  audience: "jitsu-destination-accounts",
} as const;
// Session JWT consumers may not check issuer/audience. Never let a draft grant authenticate as a session.
const signingKey = (secret: string) => createHmac("sha256", secret).update("jitsu-destination-draft:v1").digest();

/** Never sign a caller-selected connection ID: an unsaved connection has no database owner to check. */
export function createDestinationDraft(
  workspaceId: string,
  userId: string,
  destinationType: AccountDiscoveryProvider,
  secret: string
) {
  if (!secret) throw new ApiError("Draft authorization is not configured", { status: 503 });
  AccountDiscoveryProvider.parse(destinationType);
  const destinationId = cuid();
  return {
    destinationId,
    grant: jwt.sign(
      {
        workspaceId,
        userId,
        destinationId,
        destinationType,
        oauthIntegrationId: accountDiscoveryIntegrations[destinationType],
      },
      signingKey(secret),
      { ...signing, expiresIn: "24h" }
    ),
  };
}

export function readDestinationDraft(
  grant: string,
  workspaceId: string,
  userId: string,
  destinationType: AccountDiscoveryProvider,
  secret: string
) {
  try {
    const value = claims.parse(
      jwt.verify(grant, signingKey(secret), {
        algorithms: ["HS256"],
        issuer: signing.issuer,
        audience: signing.audience,
      })
    );
    if (
      value.workspaceId !== workspaceId ||
      value.userId !== userId ||
      value.destinationType !== destinationType ||
      value.oauthIntegrationId !== accountDiscoveryIntegrations[destinationType]
    )
      throw new Error();
    return value;
  } catch {
    throw new ApiError("Draft authorization expired or is invalid. Reopen this form and authorize again.", {
      status: 409,
    });
  }
}

export async function destinationDraftAccounts(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
  destinationType: AccountDiscoveryProvider,
  grant: string,
  deps: { secret: string; nango: NangoConfig; developerToken?: string; request?: typeof fetch },
  draftDeveloperToken?: string
) {
  if (destinationType === "microsoft-ads") await assertModelsEnabled(prisma, workspaceId);
  const { destinationId, oauthIntegrationId } = readDestinationDraft(
    grant,
    workspaceId,
    userId,
    destinationType,
    deps.secret
  );
  // Once saved (even if subsequently deleted), only the normal workspace-scoped lookup may read it.
  if (await prisma.configurationObject.findUnique({ where: { id: destinationId }, select: { id: true } })) {
    throw new ApiError("This destination was already saved. Reopen it to browse accounts.", { status: 409 });
  }
  return destinationAccountsForConfig(
    destinationType,
    {
      authorized: true,
      oauthIntegrationId,
      oauthConnectionId: `destination.${destinationId}`,
      developerToken: draftDeveloperToken,
    },
    destinationId,
    deps.nango,
    deps.developerToken,
    deps.request
  );
}
