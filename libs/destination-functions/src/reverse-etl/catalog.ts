// Browser-safe catalog. Runtime registration is deliberately a separate module.
import type { ReverseStreamEditor } from "@jitsu/protocols/reverse-etl-editor";
import { googleAdsMetadata, validateGoogleReverseSettings } from "../functions/google-ads/meta";
import { webhookMetadata } from "../functions/webhook/editor";
import { validateWebhookReverseSettings } from "../functions/webhook/reverse-meta";
import { metaAdsMetadata } from "../functions/facebook/editor";
import { validateMetaReverseSettings } from "../functions/facebook/reverse-meta";

/**
 * Validates a sync's settings at save time. `destination` is the saved destination configuration, so a provider can
 * reject an unusable destination (for example an unsupported URL or method) with a readable message instead of failing
 * at run time. Validators that do not need it may declare fewer parameters.
 */
export type ReverseSettingsValidator = (
  options: { stream: string; mode: "upsert" | "mirror"; streamOptions: unknown; mapping: Record<string, string> },
  model: { cursor?: unknown; deleteColumn?: unknown; primaryKey?: string[] },
  destination: Record<string, unknown>
) => void;

export interface ReverseDestinationMetadata {
  id: string;
  displayName: string;
  streams: ReverseStreamEditor[];
  validateSettings: ReverseSettingsValidator;
}

export const reverseDestinationMetadata = new Map<string, ReverseDestinationMetadata>([
  ["google-ads", { ...googleAdsMetadata, validateSettings: validateGoogleReverseSettings }],
  ["webhook", { ...webhookMetadata, validateSettings: validateWebhookReverseSettings }],
  ["facebook-conversions", { ...metaAdsMetadata, validateSettings: validateMetaReverseSettings }],
]);
