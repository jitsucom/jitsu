import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  listGoogleAccounts,
  GoogleAccountLookupError,
} from "@jitsu/destination-functions/src/functions/google-ads/accounts";
import { ApiError } from "../shared/errors";
import {
  AccountDiscoveryProvider,
  accountDiscoveryIntegrations,
  DestinationAccounts,
} from "../schema/destination-accounts";
import { assertModelsEnabled } from "./reverse-etl-models";
import { microsoftOptionsForConfig } from "./reverse-microsoft-options";
import { readGoogleAudienceConnectionToken } from "./google-audience-oauth";
import type { NangoConfig } from "./oauth/nango-config";

/** Caller has verified ownership of either a saved destination or a signed, provider-bound draft. */
export async function destinationAccountsForConfig(
  provider: AccountDiscoveryProvider,
  config: unknown,
  destinationId: string,
  nango: NangoConfig,
  developerToken?: string,
  request: typeof fetch = fetch
) {
  if (provider === "microsoft-ads") {
    const result = await microsoftOptionsForConfig(
      config,
      destinationId,
      "microsoft-account",
      nango,
      developerToken,
      request
    );
    return DestinationAccounts.parse({
      ...result,
      options: result.options.map(option => ({ ...option, accountId: option.value })),
    });
  }
  const credentials = z
    .object({
      oauthIntegrationId: z.literal(accountDiscoveryIntegrations[provider]),
      oauthConnectionId: z.literal(`destination.${destinationId}`),
      developerToken: z.string().optional(),
    })
    .safeParse(config);
  if (!credentials.success)
    throw new ApiError("Authorize this Google Ads destination before browsing accounts.", { status: 409 });
  const signal = AbortSignal.timeout(25_000);
  try {
    const { accessToken } = await readGoogleAudienceConnectionToken(
      credentials.data.oauthConnectionId,
      nango,
      request,
      signal
    );
    return await listGoogleAccounts(
      accessToken,
      developerToken?.trim() || credentials.data.developerToken,
      request,
      signal
    );
  } catch (error) {
    throw new ApiError(
      error instanceof GoogleAccountLookupError
        ? error.message
        : "Google OAuth is unavailable. Reauthorize this destination.",
      { status: 409 }
    );
  }
}

export async function savedDestinationAccounts(
  prisma: PrismaClient,
  workspaceId: string,
  destinationId: string,
  provider: AccountDiscoveryProvider,
  nango: NangoConfig,
  developerToken?: string,
  request?: typeof fetch
) {
  if (provider === "microsoft-ads") await assertModelsEnabled(prisma, workspaceId);
  const destination = await prisma.configurationObject.findFirst({
    where: { id: destinationId, workspaceId, type: "destination", deleted: false },
  });
  const config = destination?.config as Record<string, unknown> | undefined;
  if (config?.destinationType !== provider) throw new ApiError("Destination not found", { status: 404 });
  return destinationAccountsForConfig(provider, config, destinationId, nango, developerToken, request);
}
