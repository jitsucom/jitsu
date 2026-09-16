import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import {
  GoogleAudienceCredentials,
  googleDataManagerOAuthIntegration,
} from "@jitsu/destination-functions/src/functions/google-ads-reverse/meta";
import { readReverseSync } from "./reverse-sync-export";
import type { NangoConfig } from "./oauth/nango-config";

export function authorizeReverseRunner(authorization: string | undefined, secret: string | undefined) {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const connection = z.object({
  connection_id: z.string(),
  provider_config_key: z.literal(googleDataManagerOAuthIntegration),
  credentials: z.object({
    access_token: z.string().min(1).max(16384),
    expires_at: z.string().datetime({ offset: true }),
  }),
});

/** No caller-supplied Nango connection/integration/host; resolve from the current scoped sync. */
export async function readReverseGoogleToken(
  prisma: PrismaClient,
  input: { syncId: string; workspaceId: string; configRevision: string },
  nango: NangoConfig,
  request: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(15_000)
) {
  // This error intentionally carries no provider response, credentials or config values.
  const denied = () => new Error("Reverse sync OAuth unavailable; verify admission, revision and Google authorization");
  try {
    const read = () =>
      prisma.$transaction(tx => readReverseSync(tx, input.syncId, input.workspaceId), {
        isolationLevel: "RepeatableRead",
      });
    const config = await read();
    if (
      !nango.enabled ||
      !config ||
      config.configRevision !== input.configRevision ||
      config.destination.destinationType !== "google-ads"
    )
      throw denied();
    const credentials = GoogleAudienceCredentials.safeParse(config.destination);
    if (!credentials.success || credentials.data.oauthConnectionId !== `destination.${config.toId}`) throw denied();
    const url = new URL(
      `${nango.nangoApiHost.replace(/\/$/, "")}/connection/${encodeURIComponent(credentials.data.oauthConnectionId)}`
    );
    url.searchParams.set("provider_config_key", googleDataManagerOAuthIntegration);
    const response = await request(url, {
      headers: { Authorization: `Bearer ${nango.secretKey}` },
      redirect: "error",
      signal,
    });
    if (!response.ok) throw denied();
    const parsed = connection.safeParse(await response.json());
    if (!parsed.success || parsed.data.connection_id !== credentials.data.oauthConnectionId) throw denied();
    // Recheck after Nango I/O: never return a token if the sync was disabled/edited meanwhile.
    const current = await read();
    if (!current || current.configRevision !== input.configRevision || current.toId !== config.toId) throw denied();
    const expiresAt = Math.min(Date.parse(parsed.data.credentials.expires_at) - 60_000, Date.now() + 300_000);
    if (expiresAt <= Date.now() + 30_000) throw denied();
    return { accessToken: parsed.data.credentials.access_token, expiresAt: new Date(expiresAt).toISOString() };
  } catch {
    throw denied();
  }
}
