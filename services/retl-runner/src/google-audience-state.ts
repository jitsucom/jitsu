// Compatibility entry point. Provider workflow lives in destination-functions.
import type { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import type { Database } from "./persistence/database";
import { resolveGoogleAudience as resolve } from "@jitsu/destination-functions/src/functions/google-ads/audience/provisioning";
import { createTargetState } from "./target-state";
export function resolveGoogleAudience(
  config: ReverseRunConfig,
  db: Database,
  signal: AbortSignal,
  getAccessToken: (signal: AbortSignal) => Promise<string>,
  log: (message: string) => Promise<unknown>
): Promise<ReverseRunConfig> {
  return resolve(config, {
    signal,
    getAccessToken,
    log,
    fetch,
    targetState: key => createTargetState(db, config, key),
  });
}
