import { z } from "zod";
import { GoogleConversionCredentials } from "./conversions/meta";
import { dataManagerBaseUrl, dataManagerHeaders } from "./clients/data-manager";
import { googleAdsBaseUrl, googleAdsHeaders } from "./clients/google-ads";

/** Read-only provider lookup. The host has already authorized access to these credentials. */
export async function listGoogleTargets(
  c: z.infer<typeof GoogleConversionCredentials>,
  kind: "audience" | "conversion-action",
  accessToken: string,
  developerToken?: string,
  request: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(20_000)
) {
  const token = c.developerToken || developerToken;
  if (kind === "conversion-action" && !token) throw new Error("no developer token");
  const result: { value: string; label: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url =
      kind === "audience"
        ? `${dataManagerBaseUrl}accountTypes/GOOGLE_ADS/accounts/${c.customerId}/userLists?${new URLSearchParams({
            pageSize: "100",
            ...(pageToken ? { pageToken } : {}),
          })}`
        : `${googleAdsBaseUrl}customers/${c.customerId}/googleAds:search`;
    const response = await request(url, {
      signal,
      redirect: "error",
      method: kind === "audience" ? "GET" : "POST",
      headers:
        kind === "conversion-action"
          ? googleAdsHeaders(accessToken, token!, c.loginCustomerId)
          : dataManagerHeaders(accessToken, c.loginCustomerId),
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
}
