import type { z } from "zod";
import type { ReverseEditorField, ReverseEditorPatch, ReverseStreamEditor } from "@jitsu/protocols/reverse-etl-editor";
import {
  GoogleConversionOptions,
  googleConversionRows,
  googleConversionLabels,
  type GoogleConversionStream,
} from "./meta";
const conversionFields: {
  [S in GoogleConversionStream]: [keyof z.input<(typeof googleConversionRows)[S]> & string, string, string?][];
} = {
  "click-conversions": [
    ["conversionTimestamp", "Conversion time", "Required by Google. Include a timezone."],
    ["gclid", "GCLID"],
    ["gbraid", "GBRAID"],
    ["wbraid", "WBRAID"],
    ["orderId", "Order / transaction ID", "Optional; defaults to a stable ID derived from the model primary key."],
    ["value", "Conversion value"],
    ["currency", "Currency", "Three-letter ISO currency code."],
    ["phoneCountryCode", "Phone country code"],
    ["countryCode", "Address country code"],
    ["postalCode", "Postal code"],
    ["userIpAddress", "User IP address"],
    [
      "userAgent",
      "User agent",
      "Click event device user agent: Data Manager only. For Google Ads API, use landingPageUserAgent in session attributes.",
    ],
    [
      "conversionEnvironment",
      "Conversion environment",
      "APP, WEB, IN_STORE, PHONE, MESSAGE or OTHER. Data Manager defaults to OTHER. Google Ads API supports APP/WEB only.",
    ],
    ["adUserData", "Ad user data consent", "Optional. Unmapped consent defaults to GRANTED."],
    ["adPersonalization", "Ad personalization consent", "Optional. Unmapped consent defaults to GRANTED."],
    ["customVariables", "Custom variables", 'Object or JSON column: {"variable_name":"value"}.'],
    [
      "sessionAttributesEncoded",
      "Session attributes (encoded)",
      "Optional base64url-encoded session attributes. Takes precedence over the structured mapping.",
    ],
    [
      "sessionAttributes",
      "Session attributes (object)",
      "Object or JSON column: gadSource, gadCampaignId, landingPageUrl, sessionStartTime (with timezone), landingPageReferrer, landingPageUserAgent.",
    ],
    ["merchantId", "Merchant Center ID"],
    ["merchantCountryCode", "Merchant feed country", "Google Ads API only."],
    ["merchantLanguageCode", "Merchant feed language", "Google Ads API only."],
    ["transactionDiscount", "Transaction-level discount"],
    ["items", "Purchased items", 'Array or JSON column: [{"productId":"sku","quantity":1,"price":10}].'],
  ],
  "call-conversions": [
    [
      "callerId",
      "Caller phone number",
      "Required by Google. E.164 format, including +country code. This identifies the call and is sent unhashed.",
    ],
    ["callTimestamp", "Call start time", "Required by Google. Include a timezone."],
    ["conversionTimestamp", "Conversion time", "Required by Google. Include a timezone."],
    ["value", "Conversion value"],
    ["currency", "Currency"],
    ["customVariables", "Custom variables", 'Object or JSON column: {"variable_name":"value"}.'],
    ["adUserData", "Ad user data consent", "Unmapped consent defaults to GRANTED."],
    ["adPersonalization", "Ad personalization consent", "Unmapped consent defaults to GRANTED."],
  ],
  "conversion-adjustments": [
    ["adjustmentType", "Adjustment type column", "Optional per-row override: ENHANCEMENT, RESTATEMENT or RETRACTION."],
    [
      "orderId",
      "Original order / transaction ID",
      "Use the original order ID when available. Required for enhancements.",
    ],
    [
      "gclid",
      "Original GCLID",
      "Alternative to order ID for retractions/restatements, together with original conversion time.",
    ],
    ["conversionTimestamp", "Original conversion time"],
    [
      "adjustmentTimestamp",
      "Adjustment time",
      "Optional; defaults to the initial preparation time and is preserved for recovery.",
    ],
    [
      "restatementValue",
      "Restated value",
      "Required only for RESTATEMENT. Send the new total value, not the difference.",
    ],
    ["restatementCurrency", "Restatement currency"],
    ["phoneCountryCode", "Phone country code"],
    ["countryCode", "Address country code"],
    ["postalCode", "Postal code"],
    ["city", "City"],
    ["state", "State / province"],
    ["userAgent", "User agent"],
  ],
};

export function googleConversionEditor(id: GoogleConversionStream): ReverseStreamEditor {
  return {
    id,
    label: googleConversionLabels[id],
    settings: GoogleConversionOptions,
    defaults: () => ({
      mode: "upsert",
      mapping: {},
      streamOptions: {
        conversionActionId: "",
        ...(id === "click-conversions"
          ? { api: "data-manager" }
          : id === "conversion-adjustments"
          ? { adjustmentType: "ENHANCEMENT" }
          : {}),
      },
    }),
    fields(options) {
      const settings = options.streamOptions;
      const change = (patch: Record<string, unknown>): ReverseEditorPatch => ({
        streamOptions: { ...settings, ...patch },
      });
      const items: ReverseEditorField[] = [
        {
          name: "Conversion action ID",
          editor: "target",
          targetKind: "conversion-action",
          value: String(settings.conversionActionId ?? ""),
          documentation:
            "In Google Ads: Goals → Conversions → Summary → open the action. Copy ctId from the page URL. This is not your customer/account ID.",
          change: conversionActionId => change({ conversionActionId }),
        },
        {
          key: "event-mode",
          editor: "notice",
          showIcon: true,
          title: "Insert new events only",
          description:
            "Use a model primary key unique to each event. Previously submitted keys are not sent again. To correct a conversion, submit a new event through Conversion adjustments.",
        },
      ];
      if (id === "click-conversions")
        items.push({
          name: "Delivery API",
          editor: "select",
          value: settings.api ?? "data-manager",
          choices: [
            { value: "data-manager", label: "Data Manager (recommended)" },
            { value: "google-ads", label: "Google Ads API (eligible existing integrations)" },
          ],
          change: api => change({ api }),
        });
      if (id !== "click-conversions" || settings.api === "google-ads")
        items.push({
          key: "ads-api",
          editor: "notice",
          title: "Google Ads API authorization",
          description:
            "Requires the adwords OAuth scope and a developer token in destination settings or the runner's GOOGLE_ADS_DEVELOPER_TOKEN environment variable.",
        });
      if (id === "conversion-adjustments")
        items.push(
          {
            name: "Default adjustment type",
            editor: "select",
            value: settings.adjustmentType ?? "ENHANCEMENT",
            choices: ["ENHANCEMENT", "RESTATEMENT", "RETRACTION"].map(value => ({ value, label: value })),
            change: adjustmentType => change({ adjustmentType }),
          },
          {
            name: "Data source",
            editor: "select",
            value: settings.dataSource ?? "FIRST_PARTY",
            choices: [
              { value: "FIRST_PARTY", label: "First-party" },
              { value: "THIRD_PARTY", label: "Third-party" },
            ],
            change: dataSource => change({ dataSource }),
          }
        );
      if (id !== "call-conversions") {
        type Key = keyof z.input<(typeof googleConversionRows)["conversion-adjustments"]>;
        const pairs: [string, Key, Key][] = [
          ["Email", "email", "hashedEmail"],
          ["Phone", "phone", "hashedPhone"],
          ["First name", "firstName", "hashedFirstName"],
          ["Last name", "lastName", "hashedLastName"],
          ...(id === "conversion-adjustments"
            ? [["Street address", "streetAddress", "hashedStreetAddress"] as [string, Key, Key]]
            : []),
        ];
        for (const [name, raw, hashed] of pairs)
          items.push({
            name,
            editor: "identifier",
            raw,
            hashed,
            documentation: "Optional. Choose raw or SHA-256. Email and phone can contain arrays.",
          });
      }
      for (const [field, name, help] of conversionFields[id])
        items.push({
          editor: "mapping",
          field,
          name,
          documentation: help ?? "Optional; leave unmapped if not used.",
        });
      return items.map(item => ({ ...item, group: "Stream settings" }));
    },
  };
}
