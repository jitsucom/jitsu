import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
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
    const c = credentials.data;
    const { accessToken } = await readGoogleAudienceConnectionToken(c.oauthConnectionId, nango, request, signal);
    const token = c.developerToken || developerToken;
    if (kind === "conversion-action" && !token) throw new Error("no developer token");
    const result: { value: string; label: string }[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const url =
        kind === "audience"
          ? `https://datamanager.googleapis.com/v1/accountTypes/GOOGLE_ADS/accounts/${
              c.customerId
            }/userLists?${new URLSearchParams({ pageSize: "100", ...(pageToken ? { pageToken } : {}) })}`
          : `https://googleads.googleapis.com/v22/customers/${c.customerId}/googleAds:search`;
      const response = await request(url, {
        signal,
        redirect: "error",
        method: kind === "audience" ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(kind === "conversion-action"
            ? { "developer-token": token!, ...(c.loginCustomerId ? { "login-customer-id": c.loginCustomerId } : {}) }
            : c.loginCustomerId
            ? { "login-account": `accountTypes/GOOGLE_ADS/accounts/${c.loginCustomerId}` }
            : {}),
        },
        ...(kind === "conversion-action"
          ? {
              body: JSON.stringify({
                query:
                  "SELECT conversion_action.id, conversion_action.name, conversion_action.type FROM conversion_action WHERE conversion_action.status != 'REMOVED'",
                ...(pageToken ? { pageToken } : {}),
              }),
            }
          : {}),
      });
      if (!response.ok) throw new Error("lookup failed");
      const data: any = await response.json();
      const entries =
        kind === "audience"
          ? z
              .array(z.object({ id: z.string(), displayName: z.string() }))
              .parse(data.userLists ?? [])
              .map(r => ({ value: r.id, label: `${r.displayName} (${r.id})` }))
          : z
              .array(z.object({ conversionAction: z.object({ id: z.string(), name: z.string(), type: z.string() }) }))
              .parse(data.results ?? [])
              .map(({ conversionAction: r }) => ({ value: r.id, label: `${r.name} (${r.id}, ${r.type})` }));
      result.push(...entries);
      pageToken = z.string().optional().parse(data.nextPageToken);
      if (!pageToken) return { options: result };
    }
    return { options: result }; // Bounded picker; manual IDs remain supported.
  } catch {
    throw new ApiError(
      "Could not load Google targets. Check OAuth scopes and the developer token for conversion actions, or enter the ID manually.",
      { status: 409 }
    );
  }
}
