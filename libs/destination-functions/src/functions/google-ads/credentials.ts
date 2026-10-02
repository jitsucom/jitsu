// Browser-safe destination credentials and presentation metadata.
import { z } from "zod";
import { eventsParamDescription } from "../lib/metadata";
export const googleDataManagerOAuthIntegration = "jitsu-cloud-dst-google-ads";
export const googleCustomerId = z
  .string()
  .regex(/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/)
  .transform(s => s.replace(/-/g, ""));
export const GoogleAudienceCredentials = z.object({
  authorized: z.literal(true),
  oauthIntegrationId: z.literal(googleDataManagerOAuthIntegration).default(googleDataManagerOAuthIntegration),
  oauthConnectionId: z.string().min(1).max(512),
  customerId: googleCustomerId,
  loginCustomerId: z.union([z.literal(""), googleCustomerId]).default(""),
});
export const GoogleConversionCredentials = GoogleAudienceCredentials.extend({ developerToken: z.string().optional() });
export const GoogleAdsCredentials = z.object({
  // Filled in by the Nango "Authorize" button in the console, hidden in the UI. Same shape as
  // SalesforceCredentials above.
  authorized: z.boolean().optional().default(false),
  oauthIntegrationId: z.string().optional().default("jitsu-cloud-dst-google-ads"),
  oauthConnectionId: z.string().optional(),

  api: z
    .enum(["data-manager", "google-ads"])
    .default("data-manager")
    .describe(
      "API::Which Google API to send conversions to." +
        "<ul>" +
        "<li><b>data-manager</b> — the <a href='https://developers.google.com/data-manager/api' target='_blank' rel='noreferrer noopener'>Data Manager API</a>. Recommended, and the only option for accounts onboarded after June 15, 2026.</li>" +
        "<li><b>google-ads</b> — the legacy <code>UploadClickConversions</code> endpoint of the Google Ads API. Requires an approved developer token, and Google no longer accepts new accounts for it. Pick this only if your account is already allowlisted.</li>" +
        "</ul>"
    ),

  customerId: z
    .string()
    .describe(
      "Customer ID::Your Google Ads account ID — 10 digits, found in the top right of the Google Ads UI. Dashes are optional."
    ),
  loginCustomerId: z
    .string()
    .optional()
    .default("")
    .describe(
      "Manager (MCC) Customer ID::Set this when a manager account is used to access the account above. Leave empty if you authorized directly with the account."
    ),

  conversionType: z
    .enum(["conversion", "enhancement"])
    .default("conversion")
    .describe(
      "Conversion Type::What kind of upload this destination performs." +
        "<ul>" +
        "<li><b>conversion</b> — report new conversions. Covers offline click conversions (matched on <code>gclid</code>) and <i>Enhanced Conversions for Leads</i> (matched on hashed user data). Requires a conversion action of type <b>Upload from clicks</b>.</li>" +
        "<li><b>enhancement</b> — <i>Enhanced Conversions for Web</i>. Does not create conversions; it attaches hashed user data to conversions your Google tag already recorded on the site, matched by <b>order ID</b>. Requires a conversion action of type <b>Website</b>, and every event must carry an order ID.</li>" +
        "</ul>"
    ),

  conversionActionId: z
    .string()
    .describe(
      "Conversion Action ID::The default conversion action for events without a per-event override." +
        "<ol>" +
        "<li>In Google Ads, open <b>Goals » Conversions » Summary</b> in the account that owns the conversion action.</li>" +
        "<li>Click the conversion action's name to open its details.</li>" +
        "<li>In your browser's address bar, find <code>ctId=</code> and copy only the number immediately after it. For example, <code>ctId=123456789&amp;</code> means enter <code>123456789</code>.</li>" +
        "</ol>" +
        "This is <b>not</b> your Customer ID, the Google tag ID (<code>AW-...</code>), or the conversion label. " +
        "For Customer Match audience syncs (Reverse ETL), no Conversion Action ID is needed; configure an audience under <b>Reverse ETL » Syncs</b> instead. " +
        "<a href='https://support.google.com/google-ads/answer/16542291?hl=en' target='_blank' rel='noreferrer noopener'>Google's guide to finding the conversion action ID</a>."
    ),
  conversionActions: z
    .array(z.string())
    .optional()
    .describe(
      "Per-event Conversion Actions::Route individual events to different conversion actions. One <code>eventName=conversionActionId</code> per line, e.g. <code>Order Completed=111222333</code>. Events not listed here use the Conversion Action ID above."
    ),
  events: z.string().optional().default("").describe(eventsParamDescription),

  eventSource: z
    .enum(["WEB", "APP", "IN_STORE", "PHONE", "MESSAGE", "OTHER"])
    .default("WEB")
    .describe(
      "Event Source::Where the conversion happened. The legacy Google Ads API only understands <code>WEB</code> and <code>APP</code>; other values are omitted from that payload."
    ),
  phoneFieldName: z
    .string()
    .optional()
    .default("")
    .describe(
      "Phone Trait Name::Name of the field in the event user traits holding the phone number. It is normalized to <a href='https://en.wikipedia.org/wiki/E.164' target='_blank' rel='noreferrer noopener'>E.164</a> and hashed before sending. If empty, no phone number is sent."
    ),
  defaultPhoneCountryCode: z
    .string()
    .optional()
    .default("")
    .describe(
      "Default Phone Country Code::Prepended to phone numbers that don't already start with <code>+</code>, e.g. <code>+1</code>. Google rejects phone numbers that aren't in E.164 format, so set this if your traits store local numbers."
    ),

  developerToken: z
    .string()
    .optional()
    .describe(
      "Developer Token::Required for Google Ads API delivery, including Reverse ETL call conversions and conversion adjustments. Leave blank if your Jitsu runner already supplies GOOGLE_ADS_DEVELOPER_TOKEN. Not needed for Data Manager audience or click uploads. Request a token under <b>API Center</b> in your Google Ads manager account."
    ),

  storeClickIds: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Remember Click IDs::Jitsu watches every event on this connection for a <code>gclid</code>/<code>gbraid</code>/<code>wbraid</code> and remembers it against the anonymous user for 90 days, so a conversion that fires later still gets attributed. Turn this off to only use click ids present on the converting event itself."
    ),
  validateOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Validate Only::Send requests with Google's <code>validateOnly</code> flag. Google checks the payload and reports errors but records nothing. Useful to verify a new setup without polluting conversion data."
    ),
});

export const GoogleAdsCredentialsUi = {
  authorized: {
    hidden: true,
  },
  oauthIntegrationId: {
    hidden: true,
  },
  oauthConnectionId: {
    hidden: true,
  },
  conversionActions: {
    editor: "StringArrayEditor",
  },
  developerToken: {
    password: true,
  },
};

export type GoogleAdsCredentials = z.infer<typeof GoogleAdsCredentials>;
