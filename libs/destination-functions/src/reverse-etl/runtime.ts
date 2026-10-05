// Server-only registry, deliberately separate from browser metadata.
import { createGoogleAdsRuntime } from "../functions/google-ads/runtime";
import { createWebhookRuntime } from "../functions/webhook/runtime";
export const reverseDestinationRuntime = new Map([
  ["google-ads", { create: createGoogleAdsRuntime }],
  ["webhook", { create: createWebhookRuntime }],
]);
