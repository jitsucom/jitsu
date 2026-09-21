import type { JsonObject, ReverseEtlStream, ReverseEtlContext } from "@jitsu/protocols/reverse-etl";
import type { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import type { Project } from "./persistence";
import type { MirrorRecovery, SnapshotMirrorAdapter } from "./mirror";
import { createReverseEtlRegistry } from "@jitsu/destination-functions/src/reverse-etl";
import {
  createGoogleDataManager,
  googleAudienceTargetIdentity,
  projectGoogleAudience,
} from "@jitsu/destination-functions/src/functions/google-ads-reverse";
import {
  GoogleAudienceCredentials,
  GoogleAudienceOptions,
  GoogleManagedAudience,
  googleAudienceRefreshAfterMs,
} from "@jitsu/destination-functions/src/functions/google-ads-reverse/meta";
import { createGoogleAudienceManagement } from "@jitsu/destination-functions/src/functions/google-ads-reverse/audiences";
import { resolveGoogleAudience } from "./google-audience-state";
import type { Database } from "./persistence/database";

/** Trusted, compiled-in provider bindings. Implementations live in destination-functions. */
export interface RuntimeRecovery extends MirrorRecovery<JsonObject, JsonObject> {
  reconcileInit?(context: ReverseEtlContext<JsonObject, JsonObject>): Promise<"absent" | "cleaned-up">;
  /** Prove cleanup completed and old calls cannot still mutate the session. */
  reconcileAbort?(context: ReverseEtlContext<JsonObject, JsonObject>): Promise<void>;
}
export interface RuntimeAdapter {
  options?: JsonObject;
  stream: ReverseEtlStream<JsonObject, JsonObject, JsonObject>;
  credentials: JsonObject;
  targetIdentity: string;
  project: Project;
  mirror?: SnapshotMirrorAdapter<JsonObject, JsonObject, JsonObject>;
  /** Verify the remote baseline, not an unchecked UI assertion. */
  verifyMirrorBaseline?(signal: AbortSignal): Promise<"new-empty" | "tracked" | "replace">;
  recovery?(providerState: JsonObject): RuntimeRecovery;
}
export interface AdapterRuntime {
  db: Database;
  signal: AbortSignal;
  log(message: string): Promise<unknown>;
}
export type AdapterRegistry = ReadonlyMap<
  string,
  (config: ReverseRunConfig, runtime?: AdapterRuntime) => RuntimeAdapter | Promise<RuntimeAdapter>
>;

/** Code-owned registry: never resolve modules/functions from user configuration. */
export function createAdapterRegistry(
  accessToken: (config: ReverseRunConfig, signal: AbortSignal) => Promise<string>
): AdapterRegistry {
  const bindGoogle = (config: ReverseRunConfig): RuntimeAdapter => {
    const credentials = GoogleAudienceCredentials.safeParse(config.destination);
    if (!credentials.success || credentials.data.oauthConnectionId !== `destination.${config.toId}`)
      throw new Error("Invalid Google audience OAuth binding");
    const options = GoogleAudienceOptions.parse(config.options.streamOptions);
    const replacement = options.mirrorStrategy === "full-replace";
    if (replacement && config.options.mode !== "mirror") throw new Error("Full replacement requires mirror mode");
    const managed = options.managedAudienceId
      ? GoogleManagedAudience.parse(config.destination.reverseManagedAudience)
      : undefined;
    if (
      managed &&
      (managed.id !== options.managedAudienceId ||
        managed.syncId !== config.id ||
        managed.audienceId !== options.audienceId ||
        managed.customerId !== credentials.data.customerId)
    )
      throw new Error("Managed Google audience binding mismatch");
    if (config.options.mode === "mirror" && !managed && !replacement)
      throw new Error("Existing Google audiences cannot be mirrored");
    const getToken = (signal: AbortSignal) => accessToken(config, signal);
    const google = createGoogleDataManager(getToken, managed, replacement ? "native-replace" : "snapshot-diff");
    const registry = createReverseEtlRegistry({ "builtin.reverse.google-ads": google.destination });
    const stream =
      config.options.mode === "mirror" ? google.mirrorStream : registry.get("builtin.reverse.google-ads")!.streams[0];
    return {
      options: config.options.streamOptions as JsonObject,
      stream,
      credentials: credentials.data,
      targetIdentity: googleAudienceTargetIdentity(credentials.data, config.options.streamOptions),
      project: projectGoogleAudience,
      ...(managed || replacement
        ? {
            mirror: {
              stream,
              projection: {
                rowType: google.stream.rowType,
                project: (row: JsonObject) => projectGoogleAudience("upsert", row),
              },
              batchDelivery: "asynchronous" as const,
              ...(replacement ? {} : { refreshAfterMs: googleAudienceRefreshAfterMs }),
            },
            verifyMirrorBaseline: async (signal: AbortSignal) => {
              const management = createGoogleAudienceManagement(credentials.data, getToken);
              if (managed) await management.verifyManaged(managed, signal);
              else await management.verifyExisting(options.audienceId, signal);
              if (replacement) return "replace" as const;
              return "tracked" as const; // Exclusively tracked from its recorded creation, not estimated Google size.
            },
          }
        : {}),
      recovery: () => google.recovery,
    };
  };
  return new Map([
    [
      "google-ads",
      (config, runtime) => {
        if (config.options.streamOptions.audience !== undefined) {
          if (!runtime) throw new Error("Google audience provisioning requires runner state");
          return resolveGoogleAudience(
            config,
            runtime.db,
            runtime.signal,
            signal => accessToken(config, signal),
            runtime.log
          ).then(bindGoogle);
        }
        return bindGoogle(config);
      },
    ],
  ]);
}
