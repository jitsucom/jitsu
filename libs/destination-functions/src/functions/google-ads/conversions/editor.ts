import type { z } from "zod";
import type {
  ReverseEditorField,
  ReverseEditorOptions,
  ReverseEditorPatch,
  ReverseStreamEditor,
} from "@jitsu/protocols/reverse-etl-editor";
import { alternative, contactAlternatives, settingKey, withFieldRules } from "../../../reverse-etl/editor";
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
    alternatives(options) {
      const contacts = contactAlternatives();
      if (id === "call-conversions") return [];
      if (id === "click-conversions")
        return [
          {
            key: "matching",
            title: "Conversion matching",
            description:
              "Supply at least one matching option for each row. Any address supplied must be complete. Multiple matching options are allowed.",
            options: [
              alternative("GCLID", "gclid"),
              alternative("GBRAID", "gbraid"),
              alternative("WBRAID", "wbraid"),
              ...(options.streamOptions.api === "google-ads" ? contacts.slice(0, 2) : contacts),
              alternative("Session attributes (encoded)", "sessionAttributesEncoded"),
              alternative("Session attributes (object)", "sessionAttributes"),
            ],
          },
        ];
      const dynamic = !!options.mapping.adjustmentType;
      const enhancement = (options.streamOptions.adjustmentType ?? "ENHANCEMENT") === "ENHANCEMENT";
      return [
        {
          key: "adjustment-type",
          title: "Adjustment type",
          beforeRequired: true,
          description:
            "Choose a default or map a column to override it per row. Missing or null column values use the default. A fixed type determines the required fields below; mapped types are checked per row.",
          options: [
            { label: "Default adjustment type", fields: [settingKey("Default adjustment type")] },
            alternative("Adjustment type column", "adjustmentType"),
          ],
        },
        ...(dynamic || !enhancement
          ? [
              {
                key: "original",
                title: "Original conversion",
                condition: dynamic ? "For RESTATEMENT and RETRACTION rows" : undefined,
                options: [
                  alternative("Order ID", "orderId"),
                  alternative("GCLID AND original conversion time", "gclid", "conversionTimestamp"),
                ],
              },
            ]
          : []),
        ...(dynamic || enhancement
          ? [
              {
                key: "enhancement",
                title: "Enhanced matching",
                condition: dynamic ? "For ENHANCEMENT rows; original order ID is also required" : undefined,
                description:
                  "Provide email, phone or a complete address. If any address part is supplied, complete the address even when email or phone is also supplied.",
                options: contacts,
              },
            ]
          : []),
      ];
    },
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
          presentation: "description",
          title:
            id === "conversion-adjustments"
              ? "Each adjustment needs a new model primary key. Map the original conversion separately; previously sent adjustments are not resent."
              : "Only new model primary keys are sent; changes to previously sent rows are not resent.",
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
            documentation:
              "Choose raw or SHA-256. Email and phone can contain arrays. Address matching requires first name, last name, country and postal code.",
          });
      }
      for (const [field, name, help] of conversionFields[id])
        items.push({
          editor: "mapping",
          field,
          object:
            field === "customVariables"
              ? { additionalProperties: true }
              : field === "sessionAttributes"
              ? {
                  properties: [
                    ["gadSource", "Google Ads source"],
                    ["gadCampaignId", "Google Ads campaign ID"],
                    ["landingPageUrl", "Landing page URL"],
                    ["sessionStartTime", "Session start time"],
                    ["landingPageReferrer", "Landing page referrer"],
                    ["landingPageUserAgent", "Landing page user agent"],
                  ].map(([key, name]) => ({ key, name })),
                }
              : undefined,
          name,
          documentation: help ?? "Optional; leave unmapped if not used.",
        });
      const adjustment = (o: ReverseEditorOptions) => o.streamOptions.adjustmentType ?? "ENHANCEMENT";
      const enhancementHidden = (o: ReverseEditorOptions) =>
        id === "conversion-adjustments" && !o.mapping.adjustmentType && adjustment(o) !== "ENHANCEMENT";
      const addressHidden = (o: ReverseEditorOptions) =>
        enhancementHidden(o) || (id === "click-conversions" && o.streamOptions.api === "google-ads");
      return withFieldRules(items, {
        "setting:Conversion action ID": { required: true },
        "setting:Delivery API": { required: true },
        "setting:Data source": { hidden: enhancementHidden },
        ...Object.fromEntries(["email", "phone"].map(key => [`mapping:${key}`, { hidden: enhancementHidden }])),
        ...Object.fromEntries(
          ["firstName", "lastName", "countryCode", "postalCode", "streetAddress", "city", "state"].map(key => [
            `mapping:${key}`,
            { hidden: addressHidden },
          ])
        ),
        "mapping:phoneCountryCode": { hidden: o => enhancementHidden(o) || !o.mapping.phone },
        "mapping:conversionTimestamp": {
          required: id !== "conversion-adjustments",
          hidden: o => id === "conversion-adjustments" && !o.mapping.adjustmentType && adjustment(o) === "ENHANCEMENT",
        },
        "mapping:callerId": { required: true },
        "mapping:callTimestamp": { required: true },
        "mapping:orderId": {
          required: o =>
            id === "conversion-adjustments" && !o.mapping.adjustmentType && adjustment(o) === "ENHANCEMENT",
          requirement:
            id === "conversion-adjustments"
              ? "Required for ENHANCEMENT rows; otherwise use order ID or GCLID with conversion time."
              : undefined,
        },
        "mapping:gclid": {
          hidden: o => id === "conversion-adjustments" && !o.mapping.adjustmentType && adjustment(o) === "ENHANCEMENT",
        },
        "mapping:restatementValue": {
          required: o => !o.mapping.adjustmentType && adjustment(o) === "RESTATEMENT",
          hidden: o => !o.mapping.adjustmentType && adjustment(o) !== "RESTATEMENT",
          requirement: "Required for RESTATEMENT rows. Send the new total, not the difference.",
        },
        "mapping:restatementCurrency": { hidden: o => !o.mapping.adjustmentType && adjustment(o) !== "RESTATEMENT" },
        "mapping:userAgent": {
          hidden: o => enhancementHidden(o) || (id === "click-conversions" && o.streamOptions.api === "google-ads"),
        },
        ...Object.fromEntries(
          ["merchantCountryCode", "merchantLanguageCode"].map(key => [
            `mapping:${key}`,
            { hidden: (o: ReverseEditorOptions) => o.streamOptions.api !== "google-ads" },
          ])
        ),
        "mapping:customVariables": {
          requirement:
            id === "click-conversions"
              ? "Google Ads API does not allow custom variables on rows that also supply user identifiers."
              : undefined,
        },
      });
    },
  };
}
