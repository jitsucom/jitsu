// Browser-safe configuration/metadata only. Hashing, OAuth and HTTP live in index.ts.
import { z } from "zod";

export const googleDataManagerOAuthIntegration = "jitsu-cloud-dst-google-ads";
const customerId = z
  .string()
  .regex(/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/)
  .transform(s => s.replace(/-/g, ""));
export const GoogleAudienceCredentials = z.object({
  authorized: z.literal(true),
  oauthIntegrationId: z.literal(googleDataManagerOAuthIntegration).default(googleDataManagerOAuthIntegration),
  oauthConnectionId: z.string().min(1).max(512),
  customerId,
  loginCustomerId: z.union([z.literal(""), customerId]).default(""),
});
export const GoogleAudienceOptions = z
  .object({
    audienceId: z.string().regex(/^[1-9]\d{0,19}$/),
    customerMatchTermsAccepted: z.literal(true),
  })
  .strict();

const identifier = z.string().min(1).max(1024).nullable().optional();
const hash = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/)
  .nullable()
  .optional();
const identifiers = z.object({ email: identifier, phone: identifier, hashedEmail: hash, hashedPhone: hash });
const consent = z.enum(["GRANTED", "DENIED"]);
export const GoogleAudienceRow = identifiers
  .extend({
    adUserData: z.literal("GRANTED"),
    adPersonalization: z.literal("GRANTED"),
  })
  .strict();
export const GoogleAudienceRemoveRow = identifiers
  .extend({
    adUserData: consent.nullable().optional(),
    adPersonalization: consent.nullable().optional(),
  })
  .strict();

export const googleAudienceMetadata = {
  name: "audience",
  displayName: "Google Ads Customer Match audience",
  rowType: GoogleAudienceRow,
  removeRowType: GoogleAudienceRemoveRow,
  options: GoogleAudienceOptions,
  batchSize: 1000,
  batchDelivery: "asynchronous" as const,
  capabilities: {
    supportsUpsert: true,
    supportsExplicitRemove: true,
    mirror: "none" as const,
    replay: "reconcile-required" as const,
  },
};
