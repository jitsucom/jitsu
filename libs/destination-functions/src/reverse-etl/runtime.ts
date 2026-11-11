// Server-only registry, deliberately separate from browser metadata.
import { createGoogleAdsRuntime } from "../functions/google-ads/runtime";
import { createWebhookRuntime } from "../functions/webhook/runtime";
import { createMetaRuntime } from "../functions/facebook/runtime";
import { createMicrosoftAdsRuntime } from "../functions/microsoft-ads/runtime";
import { createOpenAiAdsRuntime } from "../functions/openai-ads/runtime";
export const reverseDestinationRuntime = new Map([
  ["microsoft-ads", { create: createMicrosoftAdsRuntime }],
  ["google-ads", { create: createGoogleAdsRuntime }],
  ["webhook", { create: createWebhookRuntime }],
  ["facebook-conversions", { create: createMetaRuntime }],
  ["openai-ads", { create: createOpenAiAdsRuntime }],
]);
