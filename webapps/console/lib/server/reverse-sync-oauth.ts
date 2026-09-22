import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { GoogleAudienceCredentials } from "@jitsu/destination-functions/src/functions/google-ads/audience/meta";
import { readReverseSync } from "./reverse-sync-export";
import type { NangoConfig } from "./oauth/nango-config";
import { readGoogleAudienceConnectionToken } from "./google-audience-oauth";

export function authorizeReverseRunner(authorization: string | undefined, secret: string | undefined) {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

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
    const token = await readGoogleAudienceConnectionToken(credentials.data.oauthConnectionId, nango, request, signal);
    // Recheck after Nango I/O: never return a token if the sync was disabled/edited meanwhile.
    const current = await read();
    if (!current || current.configRevision !== input.configRevision || current.toId !== config.toId) throw denied();
    return token;
  } catch {
    throw denied();
  }
}
