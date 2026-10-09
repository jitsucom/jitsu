import { z } from "zod";
import { microsoftOAuthIntegration } from "@jitsu/destination-functions/src/functions/microsoft-ads/meta";
import type { NangoConfig } from "./oauth/nango-config";

/** The caller derives connectionId from an admitted, workspace-scoped destination. */
export async function readMicrosoftAdsToken(
  connectionId: string,
  nango: NangoConfig,
  request: typeof fetch,
  signal: AbortSignal
) {
  const denied = () => new Error("Microsoft Ads OAuth unavailable");
  try {
    if (!nango.enabled) throw denied();
    const url = new URL(`${nango.nangoApiHost.replace(/\/$/, "")}/connection/${encodeURIComponent(connectionId)}`);
    url.searchParams.set("provider_config_key", microsoftOAuthIntegration);
    const response = await request(url, {
      headers: { Authorization: `Bearer ${nango.secretKey}` },
      redirect: "error",
      signal,
    });
    if (!response.ok) throw denied();
    const parsed = z
      .object({
        connection_id: z.literal(connectionId),
        provider_config_key: z.literal(microsoftOAuthIntegration),
        credentials: z.object({
          access_token: z.string().min(1).max(16384),
          expires_at: z.string().datetime({ offset: true }),
        }),
      })
      .parse(await response.json());
    const expiresAt = Math.min(Date.parse(parsed.credentials.expires_at) - 60_000, Date.now() + 300_000);
    if (expiresAt <= Date.now() + 30_000) throw denied();
    return { accessToken: parsed.credentials.access_token, expiresAt: new Date(expiresAt).toISOString() };
  } catch {
    throw denied();
  }
}
