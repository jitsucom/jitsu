import type { JsonObject, ReverseEtlStream, ReverseEtlContext } from "@jitsu/protocols/reverse-etl";
import type { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import type { Project } from "./persistence";
import type { MirrorRecovery, SnapshotMirrorAdapter } from "./mirror";

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

// Intentionally empty until each provider's API/recovery contract is verified.
// Never resolve modules or execute code from configuration or environment values.
export const adapters: AdapterRegistry = new Map();
