import { z } from "zod";
import { googleDataManagerOAuthIntegration } from "@jitsu/destination-functions/src/functions/google-ads/audience/meta";
import type { NangoConfig } from "./oauth/nango-config";

const connection = z.object({
  connection_id: z.string(),
  provider_config_key: z.literal(googleDataManagerOAuthIntegration),
  credentials: z.object({
    access_token: z.string().min(1).max(16384),
    expires_at: z.string().datetime({ offset: true }),
  }),
});

/** Server callers derive this connection from a workspace-scoped destination. */
export async function readGoogleAudienceConnectionToken(
  connectionId: string,
  nango: NangoConfig,
  request: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(15_000)
) {
  const denied = () => new Error("Google audience OAuth unavailable");
  try {
    if (!nango.enabled) throw denied();
    const url = new URL(`${nango.nangoApiHost.replace(/\/$/, "")}/connection/${encodeURIComponent(connectionId)}`);
    url.searchParams.set("provider_config_key", googleDataManagerOAuthIntegration);
    const response = await request(url, {
      headers: { Authorization: `Bearer ${nango.secretKey}` },
      redirect: "error",
      signal,
    });
    if (!response.ok) throw denied();
    const parsed = connection.safeParse(await response.json());
    if (!parsed.success || parsed.data.connection_id !== connectionId) throw denied();
    const expiresAt = Math.min(Date.parse(parsed.data.credentials.expires_at) - 60_000, Date.now() + 300_000);
    if (expiresAt <= Date.now() + 30_000) throw denied();
    return { accessToken: parsed.data.credentials.access_token, expiresAt: new Date(expiresAt).toISOString() };
  } catch {
    throw denied();
  }
}
