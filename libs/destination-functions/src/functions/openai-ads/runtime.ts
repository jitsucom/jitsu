import type {
  DestinationServices,
  ReverseDestinationConfig,
  ReverseRuntimeAdapter,
} from "@jitsu/protocols/reverse-etl-runtime";
import type { JsonObject } from "@jitsu/protocols/reverse-etl";
import { createReverseEtlRegistry } from "../../reverse-etl";
import { OpenAiWait, realWait } from "./ads-client";
import { OpenAiAdsCredentials, validateOpenAiAdsReverseSettings } from "./reverse-meta";
import { createOpenAiConversions } from "./conversions";
import { createOpenAiAudience } from "./audience";
import { resolveOpenAiAudience } from "./audience-provisioning";

export async function createOpenAiAdsRuntime(
  config: ReverseDestinationConfig,
  services: DestinationServices,
  /** Timing for polling and retries; tests pass a virtual clock, production uses real timers. */
  wait: OpenAiWait = realWait
): Promise<ReverseRuntimeAdapter> {
  validateOpenAiAdsReverseSettings(config.options, config.model, config.destination);
  const credentials = OpenAiAdsCredentials.parse(config.destination);
  let adapter: ReverseRuntimeAdapter;
  if (config.options.stream === "audience") {
    const resolved = await resolveOpenAiAudience(config, services, wait);
    adapter = createOpenAiAudience(
      credentials as JsonObject,
      resolved.settings as JsonObject,
      resolved,
      services,
      wait
    );
  } else {
    adapter = createOpenAiConversions(credentials, config.options.streamOptions, config.id, services);
  }
  createReverseEtlRegistry({
    "builtin.reverse.openai-ads": {
      credentials: OpenAiAdsCredentials,
      defaultStream: adapter.stream.name,
      streams: [adapter.stream],
    },
  });
  return adapter;
}
