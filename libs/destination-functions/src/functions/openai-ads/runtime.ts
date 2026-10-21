import type {
  DestinationServices,
  ReverseDestinationConfig,
  ReverseRuntimeAdapter,
} from "@jitsu/protocols/reverse-etl-runtime";
import { createReverseEtlRegistry } from "../../reverse-etl";
import { OpenAiAdsCredentials, validateOpenAiAdsReverseSettings } from "./reverse-meta";
import { createOpenAiConversions } from "./conversions";

export async function createOpenAiAdsRuntime(
  config: ReverseDestinationConfig,
  services: DestinationServices
): Promise<ReverseRuntimeAdapter> {
  validateOpenAiAdsReverseSettings(config.options, config.model);
  const credentials = OpenAiAdsCredentials.parse(config.destination);
  const adapter = createOpenAiConversions(credentials, config.options.streamOptions, config.id, services);
  createReverseEtlRegistry({
    "builtin.reverse.openai-ads": {
      credentials: OpenAiAdsCredentials,
      defaultStream: adapter.stream.name,
      streams: [adapter.stream],
    },
  });
  return adapter;
}
