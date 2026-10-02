// Server-only registry, deliberately separate from browser metadata.
import { createGoogleAdsRuntime } from "../functions/google-ads/runtime";
import { createMetaRuntime } from "../functions/facebook/runtime";
export const reverseDestinationRuntime = new Map([
  ["google-ads", { create: createGoogleAdsRuntime }],
  ["facebook-conversions", { create: createMetaRuntime }],
]);
