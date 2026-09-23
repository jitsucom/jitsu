import type { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import type { ReverseRuntimeAdapter, ReverseRuntimeRecovery } from "@jitsu/protocols/reverse-etl-runtime";
import { reverseDestinationRuntime } from "@jitsu/destination-functions/src/reverse-etl/runtime";
import type { Database } from "./persistence/database";
import { createTargetState } from "./target-state";
export type RuntimeAdapter = ReverseRuntimeAdapter;
export type RuntimeRecovery = ReverseRuntimeRecovery;
export interface AdapterRuntime {
  db: Database;
  signal: AbortSignal;
  log(message: string): Promise<unknown>;
}
export type AdapterRegistry = ReadonlyMap<
  string,
  (config: ReverseRunConfig, runtime?: AdapterRuntime) => RuntimeAdapter | Promise<RuntimeAdapter>
>;

/** Host binds OAuth and scoped persistence; providers cannot access the database or workspace services. */
export function createAdapterRegistry(
  accessToken: (config: ReverseRunConfig, signal: AbortSignal) => Promise<string>
): AdapterRegistry {
  return new Map(
    [...reverseDestinationRuntime].map(([id, provider]) => [
      id,
      (config: ReverseRunConfig, runtime?: AdapterRuntime) =>
        provider.create(config, {
          getAccessToken: signal => accessToken(config, signal),
          fetch,
          signal: runtime?.signal ?? new AbortController().signal,
          log: runtime?.log ?? (async () => {}),
          targetState: runtime ? key => createTargetState(runtime.db, config, key) : undefined,
          developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        }),
    ])
  );
}
