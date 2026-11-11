import { GoogleRequestError } from "@jitsu/destination-functions/src/functions/google-ads/clients/errors";
import type { PrismaClient } from "@prisma/client";
import { listGoogleTargets } from "@jitsu/destination-functions/src/functions/google-ads/targets";
import { GoogleConversionCredentials } from "@jitsu/destination-functions/src/functions/google-ads/conversions/meta";
import { assertModelsEnabled } from "./reverse-etl-models";
import { readGoogleAudienceConnectionToken } from "./google-audience-oauth";
import type { NangoConfig } from "./oauth/nango-config";
import { ApiError } from "../shared/errors";

/** Read-only, workspace-scoped picker. Only sanitized provider diagnostics may reach the browser; never OAuth credentials or raw responses. */
export async function reverseGoogleOptions(
  prisma: PrismaClient,
  workspaceId: string,
  destinationId: string,
  kind: "audience" | "conversion-action",
  nango: NangoConfig,
  developerToken?: string,
  request: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(20_000)
) {
  await assertModelsEnabled(prisma, workspaceId);
  const destination = await prisma.configurationObject.findFirst({
    where: { id: destinationId, workspaceId, type: "destination", deleted: false },
  });
  const config = destination?.config as Record<string, unknown> | undefined;
  if (config?.destinationType !== "google-ads") throw new ApiError("Google Ads destination not found", { status: 404 });
  const credentials = GoogleConversionCredentials.safeParse(config);
  if (!credentials.success || credentials.data.oauthConnectionId !== `destination.${destinationId}`)
    throw new ApiError("Connect this Google Ads destination to browse targets", { status: 409 });
  try {
    const { accessToken } = await readGoogleAudienceConnectionToken(
      credentials.data.oauthConnectionId,
      nango,
      request,
      signal
    );
    return await listGoogleTargets(credentials.data, kind, accessToken, developerToken, request, signal);
  } catch (error) {
    throw new ApiError(
      `Could not load Google targets.${
        error instanceof GoogleRequestError ? ` ${error.message}.` : ""
      } Check OAuth scopes and the developer token for conversion actions, or enter the ID manually.`,
      { status: 409 }
    );
  }
}
