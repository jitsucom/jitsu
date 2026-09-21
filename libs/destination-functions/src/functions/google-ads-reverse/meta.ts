// Browser-safe configuration/metadata only. Hashing, OAuth and HTTP live in index.ts.
import { z } from "zod";

export const googleDataManagerOAuthIntegration = "jitsu-cloud-dst-google-ads";
const customerId = z
  .string()
  .regex(/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/)
  .transform(s => s.replace(/-/g, ""));
export const googleAudienceMembershipDays = 540;
export const googleAudienceRefreshAfterMs = 30 * 86400_000;
export const managedGoogleAudienceId = z.string().regex(/^retl-google-[a-f0-9]{64}$/);
/** Runner-owned provisioning evidence, never accepted as a UI assertion. */
export const GoogleManagedAudience = z
  .object({
    id: managedGoogleAudienceId,
    syncId: z.string().min(1).max(128),
    customerId,
    audienceId: z.string().regex(/^[1-9]\d{0,19}$/),
    integrationCode: z.string().regex(/^jitsu-retl-[a-f0-9]{64}$/),
    displayName: z.string().min(1).max(255),
    membershipDays: z.literal(540),
  })
  .strict();
export type GoogleManagedAudience = z.infer<typeof GoogleManagedAudience>;
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
    managedAudienceId: managedGoogleAudienceId.optional(),
    customerMatchTermsAccepted: z.literal(true),
    mirrorStrategy: z.enum(["snapshot-diff", "full-replace"]).optional(),
    exclusiveManagementConfirmed: z.literal(true).optional(),
  })
  .strict()
  .superRefine((options, ctx) => {
    if (options.mirrorStrategy === "full-replace" && !options.exclusiveManagementConfirmed)
      ctx.addIssue({ code: "custom", message: "Full replacement requires exclusive audience management confirmation" });
  });

/** User intent stored on the link; generated audience identity belongs to runtime state. */
export const GoogleAudienceSettings = z
  .object({
    audience: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("managed"), displayName: z.string().trim().min(1).max(120) }).strict(),
      z.object({ kind: z.literal("existing"), audienceId: z.string().regex(/^[1-9]\d{0,19}$/) }).strict(),
    ]),
    customerMatchTermsAccepted: z.literal(true),
    exclusiveManagementConfirmed: z.literal(true).optional(),
    mirrorStrategy: z.enum(["snapshot-diff", "full-replace"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.audience.kind === "managed" || value.mirrorStrategy === "full-replace") &&
      !value.exclusiveManagementConfirmed
    )
      ctx.addIssue({ code: "custom", message: "Confirm exclusive audience management" });
  });

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
    adUserData: z.literal("GRANTED").optional(),
    adPersonalization: z.literal("GRANTED").optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    // Only unmapped fields assume consent. A mapped column with a missing value must fail,
    // just like explicit null or DENIED, rather than silently becoming GRANTED.
    for (const field of ["adUserData", "adPersonalization"] as const) {
      if (Object.hasOwn(row, field) && row[field] === undefined)
        ctx.addIssue({ code: "custom", path: [field], message: "Mapped consent must be GRANTED" });
    }
  });
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
    mirror: "snapshot-diff" as const,
    replay: "reconcile-required" as const,
  },
};
