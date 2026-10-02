import type { Prisma } from "@prisma/client";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import {
  GoogleAudienceCredentials,
  GoogleAudienceOptions,
  GoogleManagedAudience,
} from "@jitsu/destination-functions/src/functions/google-ads/audience/meta";
import {
  googleAudienceStateStream,
  LegacyGoogleAudienceState,
} from "@jitsu/destination-functions/src/functions/google-ads/audience/state";
import { ApiError } from "../shared/errors";

/** Compatibility for migrated links: reconstruct the identical legacy export from runtime state. */
export async function managedGoogleAudienceForSync(
  db: Pick<Prisma.TransactionClient, "source_state">,
  workspaceId: string,
  destinationId: string,
  ownerSyncId: string,
  rawOptions: unknown,
  destination: unknown
): Promise<GoogleManagedAudience | undefined> {
  const options = GoogleAudienceOptions.parse(rawOptions);
  if (!options.managedAudienceId) return;
  const row = await db.source_state.findUnique({
    where: { sync_id_stream: { sync_id: ownerSyncId, stream: googleAudienceStateStream } },
  });
  const state = LegacyGoogleAudienceState.safeParse(row?.state);
  const credentials = GoogleAudienceCredentials.safeParse(destination);
  if (
    !state.success ||
    !credentials.success ||
    state.data.workspaceId !== workspaceId ||
    state.data.destinationId !== destinationId ||
    state.data.configBinding !== contentHash(credentials.data) ||
    state.data.legacyManaged.id !== options.managedAudienceId ||
    state.data.legacyManaged.syncId !== ownerSyncId ||
    state.data.legacyManaged.audienceId !== options.audienceId
  )
    throw new ApiError(
      "Managed audience runtime state unavailable; run the legacy Reverse ETL settings migration before enabling this sync",
      { status: 409 }
    );
  return state.data.legacyManaged;
}
