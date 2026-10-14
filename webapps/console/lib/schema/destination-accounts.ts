import { z } from "zod";
import { microsoftOAuthIntegration } from "@jitsu/destination-functions/src/functions/microsoft-ads/meta";
import { googleDataManagerOAuthIntegration } from "@jitsu/destination-functions/src/functions/google-ads/credentials";

/** Explicit allowlist: other OAuth destinations do not automatically expose draft discovery. */
export const AccountDiscoveryProvider = z.enum(["microsoft-ads", "google-ads"]);
export type AccountDiscoveryProvider = z.infer<typeof AccountDiscoveryProvider>;
export const accountDiscoveryIntegrations: Record<AccountDiscoveryProvider, string> = {
  "microsoft-ads": microsoftOAuthIntegration,
  "google-ads": googleDataManagerOAuthIntegration,
};
export const DestinationAccount = z.object({
  value: z.string(),
  label: z.string(),
  customerId: z.string(),
  accountId: z.string().optional(),
  loginCustomerId: z.string().optional(),
});
export type DestinationAccount = z.infer<typeof DestinationAccount>;
export const DestinationAccounts = z.object({
  options: z.array(DestinationAccount),
  truncated: z.boolean().optional(),
  partial: z.boolean().optional(),
});
