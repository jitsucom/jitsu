import type {
  DestinationServices,
  ReverseDestinationConfig,
  ReverseRuntimeAdapter,
} from "@jitsu/protocols/reverse-etl-runtime";
import type { JsonObject } from "@jitsu/protocols/reverse-etl";
import { createReverseEtlRegistry } from "../../reverse-etl";
import { MetaReverseCredentials, validateMetaReverseSettings } from "./reverse-meta";
import { createMetaConversions } from "./conversions";
import { createMetaAudience } from "./audience";
import { resolveMetaAudience } from "./provisioning";

export async function createMetaRuntime(
  config: ReverseDestinationConfig,
  services: DestinationServices
): Promise<ReverseRuntimeAdapter> {
  validateMetaReverseSettings(config.options, config.model);
  const credentials = MetaReverseCredentials.parse(config.destination);
  let adapter: ReverseRuntimeAdapter;
  if (config.options.stream === "conversions") {
    adapter = createMetaConversions(credentials, config.options.streamOptions, config.id, services);
  } else {
    const resolved = await resolveMetaAudience(config, services);
    adapter = createMetaAudience(
      credentials,
      resolved.settings as JsonObject,
      resolved.audienceId,
      resolved.managed,
      services,
      resolved.verify
    );
  }
  createReverseEtlRegistry({
    "builtin.reverse.facebook-conversions": {
      credentials: MetaReverseCredentials,
      defaultStream: adapter.stream.name,
      streams: [adapter.stream],
    },
  });
  return adapter;
}
