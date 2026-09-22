import type { PrismaClient } from "@prisma/client";
import { listGoogleTargets } from "@jitsu/destination-functions/src/functions/google-ads/targets";
import { GoogleConversionCredentials } from "@jitsu/destination-functions/src/functions/google-ads-reverse/conversion-meta";
import { assertModelsEnabled } from "./reverse-etl-models";
import { readGoogleAudienceConnectionToken } from "./google-audience-oauth";
import type { NangoConfig } from "./oauth/nango-config";
import { ApiError } from "../shared/errors";

/** Read-only, workspace-scoped picker. OAuth credentials and provider diagnostics never reach the browser. */
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
  } catch {
    throw new ApiError(
      "Could not load Google targets. Check OAuth scopes and the developer token for conversion actions, or enter the ID manually.",
      { status: 409 }
    );
  }
}
