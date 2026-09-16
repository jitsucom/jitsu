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
import { GoogleAudienceCredentials } from "@jitsu/destination-functions/src/functions/google-ads-reverse/meta";

/** Trusted, compiled-in provider bindings. Implementations live in destination-functions. */
export interface RuntimeRecovery extends MirrorRecovery<JsonObject, JsonObject> {
  reconcileInit?(context: ReverseEtlContext<JsonObject, JsonObject>): Promise<"absent" | "cleaned-up">;
  /** Prove cleanup completed and old calls cannot still mutate the session. */
  reconcileAbort?(context: ReverseEtlContext<JsonObject, JsonObject>): Promise<void>;
}
export interface RuntimeAdapter {
  stream: ReverseEtlStream<JsonObject, JsonObject, JsonObject>;
  credentials: JsonObject;
  targetIdentity: string;
  project: Project;
  mirror?: SnapshotMirrorAdapter<JsonObject, JsonObject, JsonObject>;
  /** Verify the remote baseline, not an unchecked UI assertion. */
  verifyMirrorBaseline?(signal: AbortSignal): Promise<"new-empty" | "tracked">;
  recovery?(providerState: JsonObject): RuntimeRecovery;
}
export type AdapterRegistry = ReadonlyMap<string, (config: ReverseRunConfig) => RuntimeAdapter>;

/** Code-owned registry: never resolve modules/functions from user configuration. */
export function createAdapterRegistry(
  accessToken: (config: ReverseRunConfig, signal: AbortSignal) => Promise<string>
): AdapterRegistry {
  return new Map([
    [
      "google-ads",
      config => {
        const credentials = GoogleAudienceCredentials.safeParse(config.destination);
        if (!credentials.success || credentials.data.oauthConnectionId !== `destination.${config.toId}`)
          throw new Error("Invalid Google audience OAuth binding");
        const google = createGoogleDataManager(signal => accessToken(config, signal));
        const registry = createReverseEtlRegistry({ "builtin.reverse.google-ads": google.destination });
        return {
          stream: registry.get("builtin.reverse.google-ads")!.streams[0],
          credentials: credentials.data,
          targetIdentity: googleAudienceTargetIdentity(credentials.data, config.options.streamOptions),
          project: projectGoogleAudience,
          recovery: () => google.recovery,
        };
      },
    ],
  ]);
}
