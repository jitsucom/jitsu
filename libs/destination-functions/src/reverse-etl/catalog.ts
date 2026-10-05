// Browser-safe catalog. Runtime registration is deliberately a separate module.
import { googleAdsMetadata, validateGoogleReverseSettings } from "../functions/google-ads/meta";

/**
 * Validates a sync's settings at save time. `destination` is the saved destination configuration, so a provider can
 * reject an unusable destination (for example an unsupported URL or method) with a readable message instead of failing
 * at run time. Validators that do not need it may declare fewer parameters.
 */
export type ReverseSettingsValidator = (
  options: { stream: string; mode: "upsert" | "mirror"; streamOptions: unknown },
  model: { cursor?: unknown; deleteColumn?: unknown },
  destination: Record<string, unknown>
) => void;

export const reverseDestinationMetadata = new Map<
  string,
  typeof googleAdsMetadata & { validateSettings: ReverseSettingsValidator }
>([["google-ads", { ...googleAdsMetadata, validateSettings: validateGoogleReverseSettings }]]);
