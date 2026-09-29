import type { JsonObject } from "@jitsu/protocols/reverse-etl";
import type {
  ReverseDestinationConfig,
  ReverseRuntimeAdapter,
  DestinationServices,
} from "@jitsu/protocols/reverse-etl-runtime";
import { createReverseEtlRegistry } from "../../reverse-etl";
import { createGoogleDataManager, googleAudienceTargetIdentity, projectGoogleAudience } from "./audience/runtime";
import {
  GoogleAudienceCredentials,
  GoogleAudienceOptions,
  GoogleManagedAudience,
  googleAudienceRefreshAfterMs,
} from "./audience/meta";
import { createGoogleAudienceManagement } from "./audience/management";
import { resolveGoogleAudience } from "./audience/provisioning";
import { createGoogleConversions } from "./conversions/runtime";
import { GoogleConversionStream } from "./conversions/meta";

export function createGoogleAdsRuntime(
  config: ReverseDestinationConfig,
  services: DestinationServices
): ReverseRuntimeAdapter | Promise<ReverseRuntimeAdapter> {
  const bindGoogle = (config: ReverseDestinationConfig): ReverseRuntimeAdapter => {
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
    const getToken = (signal: AbortSignal) => services.getAccessToken(signal);
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
              ...(replacement
                ? {}
                : {
                    refreshAfterMs: Math.min(
                      googleAudienceRefreshAfterMs,
                      ((managed?.membershipDays ?? 540) * 86400_000) / 2
                    ),
                  }),
            },
            verifyMirrorBaseline: async (signal: AbortSignal) => {
              const management = createGoogleAudienceManagement(credentials.data, getToken, services.fetch);
              if (managed) await management.verifyManaged(managed, signal);
              else await management.verifyExisting(options.audienceId, signal, options);
              if (replacement) return "replace" as const;
              return "tracked" as const; // Exclusively tracked from its recorded creation, not estimated Google size.
            },
          }
        : {}),
      recovery: () => google.recovery,
    };
  };

  if (config.options.stream !== "audience") {
    if (config.options.mode !== "upsert" || config.model.deleteColumn)
      throw new Error("Conversion streams are insert-only and do not support tombstones");
    if (config.destination.oauthConnectionId !== `destination.${config.toId}`)
      throw new Error("Invalid Google conversion OAuth binding");
    return createGoogleConversions(
      GoogleConversionStream.parse(config.options.stream),
      config.destination,
      config.options.streamOptions,
      services.getAccessToken,
      config.id,
      services.developerToken
    );
  }
  return config.options.streamOptions.audience !== undefined
    ? resolveGoogleAudience(config, services).then(bindGoogle)
    : bindGoogle(config);
}
