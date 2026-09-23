import { z } from "zod";
import { contentHash } from "../../../reverse-etl/identity";
import { GoogleAudienceCredentials, GoogleAudienceSettings, GoogleManagedAudience } from "./meta";

export const googleAudienceStateStream = "_REVERSE_ETL_GOOGLE_AUDIENCE_";
export const GoogleAudienceState = z
  .object({
    version: z.literal(1),
    workspaceId: z.string(),
    binding: z.string(),
    phase: z.enum(["prepared", "submitting", "ready"]),
    managed: GoogleManagedAudience.omit({ audienceId: true }),
    audienceId: z.string().optional(),
  })
  .strict();
/** Legacy configs keep their original revision and artifact scope after migration. */
export const LegacyGoogleAudienceState = z
  .object({
    version: z.literal(1),
    workspaceId: z.string(),
    destinationId: z.string(),
    configBinding: z.string(),
    legacyManaged: GoogleManagedAudience,
  })
  .strict();
export function googleAudienceStateBinding(
  workspaceId: string,
  syncId: string,
  destinationId: string,
  credentials: unknown,
  settings: unknown
) {
  return contentHash({
    workspaceId,
    syncId,
    destinationId,
    credentials: GoogleAudienceCredentials.parse(credentials),
    settings: GoogleAudienceSettings.parse(settings),
  });
}
