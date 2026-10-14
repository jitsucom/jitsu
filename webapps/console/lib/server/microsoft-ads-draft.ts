import cuid from "cuid";
import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { microsoftOAuthIntegration } from "@jitsu/destination-functions/src/functions/microsoft-ads/meta";
import { ApiError } from "../shared/errors";
import { assertModelsEnabled } from "./reverse-etl-models";
import { microsoftOptionsForConfig } from "./reverse-microsoft-options";
import type { NangoConfig } from "./oauth/nango-config";

const claims = z.object({ workspaceId: z.string(), userId: z.string(), destinationId: z.string() });
const signing = { algorithm: "HS256", issuer: "jitsu-microsoft-draft", audience: "jitsu-microsoft-accounts" } as const;
// Session JWT consumers may not check issuer/audience. Never let a draft grant authenticate as a session.
const signingKey = (secret: string) => createHmac("sha256", secret).update("jitsu-microsoft-draft:v1").digest();

/** Never sign a caller-selected connection ID: an unsaved connection has no database owner to check. */
export function createMicrosoftDraft(workspaceId: string, userId: string, secret: string) {
  if (!secret) throw new ApiError("Draft authorization is not configured", { status: 503 });
  const destinationId = cuid();
  return {
    destinationId,
    grant: jwt.sign({ workspaceId, userId, destinationId }, signingKey(secret), { ...signing, expiresIn: "24h" }),
  };
}

export function readMicrosoftDraft(grant: string, workspaceId: string, userId: string, secret: string) {
  try {
    const value = claims.parse(
      jwt.verify(grant, signingKey(secret), {
        algorithms: ["HS256"],
        issuer: signing.issuer,
        audience: signing.audience,
      })
    );
    if (value.workspaceId !== workspaceId || value.userId !== userId) throw new Error();
    return value;
  } catch {
    throw new ApiError("Draft authorization expired or is invalid. Reopen this form and authorize again.", {
      status: 409,
    });
  }
}

export async function microsoftDraftAccounts(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
  grant: string,
  deps: { secret: string; nango: NangoConfig; developerToken?: string; request?: typeof fetch },
  draftDeveloperToken?: string
) {
  await assertModelsEnabled(prisma, workspaceId);
  const { destinationId } = readMicrosoftDraft(grant, workspaceId, userId, deps.secret);
  // Once saved (even if subsequently deleted), only the normal workspace-scoped lookup may read it.
  if (await prisma.configurationObject.findUnique({ where: { id: destinationId }, select: { id: true } })) {
    throw new ApiError("This destination was already saved. Reopen it to browse accounts.", { status: 409 });
  }
  return microsoftOptionsForConfig(
    {
      oauthIntegrationId: microsoftOAuthIntegration,
      oauthConnectionId: `destination.${destinationId}`,
      developerToken: draftDeveloperToken,
    },
    destinationId,
    "microsoft-account",
    deps.nango,
    deps.developerToken,
    deps.request
  );
}
