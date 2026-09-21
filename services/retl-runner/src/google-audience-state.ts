import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import {
  GoogleAudienceCredentials,
  GoogleAudienceSettings,
  GoogleManagedAudience,
} from "@jitsu/destination-functions/src/functions/google-ads-reverse/meta";
import { createGoogleAudienceManagement } from "@jitsu/destination-functions/src/functions/google-ads-reverse/audiences";
import type { Database } from "./persistence/database";
import { ensure } from "./persistence/types";
import {
  googleAudienceStateStream,
  GoogleAudienceState as State,
  googleAudienceStateBinding,
} from "@jitsu/destination-functions/src/functions/google-ads-reverse/state";

/** Called under the sync's Kubernetes lease. No remote I/O inside SQL transactions. */
export async function resolveGoogleAudience(
  config: ReverseRunConfig,
  db: Database,
  signal: AbortSignal,
  getToken: (signal: AbortSignal) => Promise<string>,
  log: (message: string) => Promise<unknown>
): Promise<ReverseRunConfig> {
  const settings = GoogleAudienceSettings.parse(config.options.streamOptions);
  ensure(config.options.stream === "audience", "Unsupported Google destination stream");
  ensure(
    config.options.mode !== "mirror" || (!config.model.cursor && !config.model.deleteColumn),
    "Mirror requires a full-query model without a cursor or delete column"
  );
  const credentials = GoogleAudienceCredentials.parse(config.destination);
  ensure(credentials.oauthConnectionId === `destination.${config.toId}`, "Invalid Google audience OAuth binding");
  const { audience, ...options } = settings;
  if (audience.kind === "existing") {
    ensure(
      config.options.mode !== "mirror" || options.mirrorStrategy === "full-replace",
      "Existing Google audiences require full replacement for mirror mode"
    );
    await createGoogleAudienceManagement(credentials, getToken).verifyExisting(audience.audienceId, signal);
    return {
      ...config,
      options: { ...config.options, streamOptions: { ...options, audienceId: audience.audienceId } },
    };
  }
  ensure(config.options.mode === "mirror", "Managed Google audiences require mirror mode");
  const binding = googleAudienceStateBinding(config.workspaceId, config.id, config.toId, credentials, settings);
  const read = () =>
    db.transaction(async client => {
      const result = await client.query("SELECT state FROM source_state WHERE sync_id=$1 AND stream=$2", [
        config.id,
        googleAudienceStateStream,
      ]);
      return result.rows[0]?.state;
    });
  let raw = await read();
  if (!raw) {
    signal.throwIfAborted();
    const nonce = randomBytes(32).toString("hex");
    const intent: z.infer<typeof State> = {
      version: 1,
      workspaceId: config.workspaceId,
      binding,
      phase: "prepared",
      managed: {
        id: `retl-google-${createHash("sha256").update(`${config.workspaceId}:${config.id}:${nonce}`).digest("hex")}`,
        syncId: config.id,
        customerId: credentials.customerId,
        integrationCode: `jitsu-retl-${nonce}`,
        displayName: `${audience.displayName} [Jitsu ${nonce.slice(0, 12)}]`,
        membershipDays: 540,
      },
    };
    await db.transaction(async client => {
      // Missing provisioning state beside an existing delivery baseline is not a fresh audience.
      const existing = await client.query("SELECT 1 FROM reverse_sync_control WHERE workspace_id=$1 AND sync_id=$2", [
        config.workspaceId,
        config.id,
      ]);
      ensure(!existing.rowCount, "Managed audience state is missing; preserve delivery state and reconcile");
      await client.query(
        "INSERT INTO source_state(sync_id,stream,state,timestamp) VALUES($1,$2,$3,clock_timestamp()) ON CONFLICT(sync_id,stream) DO NOTHING",
        [config.id, googleAudienceStateStream, JSON.stringify(intent)]
      );
    });
    raw = await read();
  }
  const saved = State.parse(raw);
  ensure(
    saved.workspaceId === config.workspaceId &&
      saved.binding === binding &&
      saved.managed.syncId === config.id &&
      saved.managed.customerId === credentials.customerId,
    "Managed audience configuration changed; preserve provisioning state and reconcile"
  );
  const api = createGoogleAudienceManagement(credentials, getToken);
  if (saved.phase !== "ready") {
    // Resolve OAuth before claiming submission: a token failure cannot create an audience.
    const token = await getToken(signal);
    const submission = createGoogleAudienceManagement(credentials, async () => token);
    signal.throwIfAborted();
    const claimed = await db.transaction(async client => {
      const next = { ...saved, phase: "submitting" };
      const result = await client.query(
        "UPDATE source_state SET state=$3,timestamp=clock_timestamp() WHERE sync_id=$1 AND stream=$2 AND state=$4::jsonb",
        [config.id, googleAudienceStateStream, JSON.stringify(next), JSON.stringify({ ...saved, phase: "prepared" })]
      );
      return result.rowCount === 1;
    });
    await log(
      claimed
        ? "Creating Google audience; provisioning intent is saved."
        : "Checking the saved Google audience creation request; no duplicate creation will be submitted."
    );
    const result = claimed
      ? await submission.create(saved.managed, signal)
      : await api.reconcile(saved.managed, signal);
    ensure(result, "Google audience creation is unconfirmed; retry status discovery without resetting state");
    saved.audienceId = result.audienceId;
    saved.phase = "ready";
    signal.throwIfAborted();
    await db.transaction(async client => {
      const result = await client.query(
        "UPDATE source_state SET state=$3,timestamp=clock_timestamp() WHERE sync_id=$1 AND stream=$2 AND state->>'binding'=$4 AND state->>'phase'='submitting'",
        [config.id, googleAudienceStateStream, JSON.stringify(saved), binding]
      );
      ensure(result.rowCount === 1, "Google audience provisioning state changed");
    });
  }
  const managed = GoogleManagedAudience.parse({ ...saved.managed, audienceId: saved.audienceId });
  await api.verifyManaged(managed, signal);
  await log(`Using Google audience ${managed.audienceId}.`);
  return {
    ...config,
    destination: { ...config.destination, reverseManagedAudience: managed },
    options: {
      ...config.options,
      streamOptions: { ...options, audienceId: managed.audienceId, managedAudienceId: managed.id },
    },
  };
}
