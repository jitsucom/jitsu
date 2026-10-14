import type { PrismaClient } from "@prisma/client";
import {
  MicrosoftAdsCredentials,
  microsoftOAuthIntegration,
} from "@jitsu/destination-functions/src/functions/microsoft-ads/meta";
import {
  listMicrosoftTargets,
  microsoftReadClient,
  MicrosoftReadError,
} from "@jitsu/destination-functions/src/functions/microsoft-ads/discovery";
import { assertModelsEnabled } from "./reverse-etl-models";
import { readMicrosoftAdsToken } from "./microsoft-ads-oauth";
import type { NangoConfig } from "./oauth/nango-config";
import { ApiError } from "../shared/errors";

export async function microsoftReadAuth(
  config: unknown,
  destinationId: string,
  nango: NangoConfig,
  developerToken?: string,
  request: typeof fetch = fetch,
  signal = AbortSignal.timeout(25_000)
) {
  const credentials = MicrosoftAdsCredentials.partial({ customerId: true, accountId: true }).safeParse(config);
  if (
    !credentials.success ||
    credentials.data.oauthIntegrationId !== microsoftOAuthIntegration ||
    credentials.data.oauthConnectionId !== `destination.${destinationId}`
  )
    throw new ApiError("Authorize and save this Microsoft Ads destination before browsing targets or results.", {
      status: 409,
    });
  try {
    const { accessToken } = await readMicrosoftAdsToken(credentials.data.oauthConnectionId, nango, request, signal);
    return {
      ...credentials.data,
      accessToken,
      developerToken: developerToken?.trim() || credentials.data.developerToken?.trim() || "",
    };
  } catch {
    throw new ApiError("Microsoft OAuth is unavailable. Reauthorize and save this destination.", { status: 409 });
  }
}
export async function reverseMicrosoftOptions(
  prisma: PrismaClient,
  workspaceId: string,
  destinationId: string,
  kind: "microsoft-account" | "microsoft-audience" | "microsoft-goal",
  nango: NangoConfig,
  developerToken?: string,
  request: typeof fetch = fetch
) {
  await assertModelsEnabled(prisma, workspaceId);
  const destination = await prisma.configurationObject.findFirst({
    where: { id: destinationId, workspaceId, type: "destination", deleted: false },
  });
  const config = destination?.config as Record<string, unknown> | undefined;
  if (config?.destinationType !== "microsoft-ads")
    throw new ApiError("Microsoft Ads destination not found", { status: 404 });
  const signal = AbortSignal.timeout(25_000);
  const auth = await microsoftReadAuth(config, destinationId, nango, developerToken, request, signal);
  try {
    return await listMicrosoftTargets(microsoftReadClient(auth, request, signal), kind);
  } catch (error) {
    throw new ApiError(
      error instanceof MicrosoftReadError
        ? error.message
        : "Microsoft target lookup returned an unsupported response. You can still enter the target manually.",
      { status: 409 }
    );
  }
}
