// Browser-safe catalog. Runtime registration is deliberately a separate module.
import { googleAdsMetadata, validateGoogleReverseSettings } from "../functions/google-ads/meta";
export const reverseDestinationMetadata = new Map([
  ["google-ads", { ...googleAdsMetadata, validateSettings: validateGoogleReverseSettings }],
]);
