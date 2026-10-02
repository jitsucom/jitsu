// Browser-safe catalog. Runtime registration is deliberately a separate module.
import { googleAdsMetadata, validateGoogleReverseSettings } from "../functions/google-ads/meta";
import { metaAdsMetadata } from "../functions/facebook/editor";
import { validateMetaReverseSettings } from "../functions/facebook/reverse-meta";
export const reverseDestinationMetadata = new Map([
  ["google-ads", { ...googleAdsMetadata, validateSettings: validateGoogleReverseSettings }],
  ["facebook-conversions", { ...metaAdsMetadata, validateSettings: validateMetaReverseSettings }],
]);
