import type {
  ReverseEditorField,
  ReverseEditorOptions,
  ReverseStreamEditor,
} from "@jitsu/protocols/reverse-etl-editor";
import {
  MetaActionSource,
  MetaMessagingChannel,
  MetaAudienceOptions,
  MetaConversionOptions,
  metaContactFields,
  metaDestinationId,
  metaDestinationTitle,
} from "./reverse-meta";

function contacts(): ReverseEditorField[] {
  return metaContactFields.map(([raw, hashed, name]) => ({
    editor: "identifier",
    raw,
    hashed,
    name,
    documentation:
      "Optional. Supply raw values or SHA-256 hashes, not both. Phone numbers must include the country code.",
  }));
}
function mappings(fields: [string, string, string?][]): ReverseEditorField[] {
  return fields.map(([field, name, documentation]) => ({ editor: "mapping", field, name, documentation }));
}
function privacy(): ReverseEditorField[] {
  return mappings([
    ["dataProcessingOptions", "Data processing options", 'Optional array or JSON column: [] or ["LDU"]. Do not hash.'],
    ["dataProcessingCountry", "Data processing country", "Optional Meta numeric country code (not an ISO code)."],
    ["dataProcessingState", "Data processing state", "Optional Meta numeric state code."],
  ]);
}
function controls(options: ReverseEditorOptions) {
  const settings = options.streamOptions;
  const change = (patch: Record<string, any>) => ({ streamOptions: { ...settings, ...patch } });
  const text = (key: string, name: string, documentation?: string): ReverseEditorField => ({
    key,
    name,
    editor: "text",
    value: String(settings[key] ?? ""),
    documentation,
    change: value => change({ [key]: value || undefined }),
  });
  return { settings, change, text };
}
export const metaAudienceEditor: ReverseStreamEditor = {
  id: "audience",
  label: "Custom Audiences",
  settings: MetaAudienceOptions,
  defaults: () => ({
    mode: "mirror",
    mapping: {},
    streamOptions: {
      accountId: "",
      audience: { kind: "managed", name: "" },
      exclusiveManagementConfirmed: false,
    },
  }),
  fields(options) {
    const { settings, change, text } = controls(options);
    const audience = settings.audience ?? { kind: "managed", name: "" };
    const managed = audience.kind === "managed";
    const items: ReverseEditorField[] = [
      text(
        "accountId",
        "Ad account ID",
        "Numeric Meta ad account ID; the act_ prefix is optional. The system user needs access and Custom Audience terms must be accepted."
      ),
      {
        editor: "select",
        name: "Audience",
        value: audience.kind,
        choices: [
          { value: "managed", label: "Create a new audience on first run" },
          { value: "existing", label: "Use an existing audience" },
        ],
        change: kind => ({
          mode: kind === "managed" ? "mirror" : "upsert",
          streamOptions: {
            ...settings,
            audience: kind === "managed" ? { kind, name: "" } : { kind, audienceId: "" },
            exclusiveManagementConfirmed: false,
          },
        }),
      },
      {
        editor: "text",
        name: managed ? "Audience name" : "Audience ID",
        value: managed ? audience.name ?? "" : audience.audienceId ?? "",
        documentation: managed
          ? "Created by the runner, not when saving this form."
          : "An existing customer-list Custom Audience in this ad account. Other audience types are not supported.",
        change: value => change({ audience: { ...audience, [managed ? "name" : "audienceId"]: value } }),
      },
      {
        editor: "notice",
        key: "audience-mode",
        title: managed ? "Mirror — changes only" : "Additions and explicit removals",
        description: managed
          ? "Jitsu uploads changes, then removes tracked members absent from the full model. An empty model clears tracked membership. Meta matching is asynchronous; accepted records are not matched people."
          : "A delete-column model can remove members explicitly. Existing membership is not imported or cleared; full mirroring is not supported for existing audiences.",
      },
      {
        editor: "checkbox",
        name: "Value-based audience",
        value: settings.valueBased === true,
        label: "This is a value-based customer list",
        documentation:
          "Map a non-negative customer value for every addition. For an existing audience, this must match its type.",
        change: valueBased => change({ valueBased }),
      },
      ...(managed
        ? [
            {
              editor: "select" as const,
              name: "Customer data source",
              value: settings.customerFileSource ?? "USER_PROVIDED_ONLY",
              choices: [
                { value: "USER_PROVIDED_ONLY", label: "Collected directly from customers" },
                { value: "PARTNER_PROVIDED_ONLY", label: "Provided by partners" },
                { value: "BOTH_USER_AND_PARTNER_PROVIDED", label: "Both" },
              ],
              change: (customerFileSource: string) => change({ customerFileSource }),
            },
          ]
        : []),
      text("pageId", "Facebook Page ID", "Only required when mapping page-scoped user IDs."),
      ...contacts(),
      ...[
        ["firstInitial", "hashedFirstInitial", "First initial"],
        ["birthYear", "hashedBirthYear", "Birth year (YYYY)"],
        ["birthMonth", "hashedBirthMonth", "Birth month"],
        ["birthDay", "hashedBirthDay", "Birth day"],
      ].map(([raw, hashed, name]): ReverseEditorField => ({ editor: "identifier", raw, hashed, name })),
      ...mappings([
        [
          "externalId",
          "External / CRM ID",
          "Optional; sent exactly as supplied, without hashing. Use the same convention as previous uploads.",
        ],
        ["mobileAdvertisingId", "Mobile advertising ID", "Optional IDFA/AAID UUID; do not hash."],
        ["pageScopedUserId", "Page-scoped user ID", "Optional; also configure Facebook Page ID above."],
        ...(settings.valueBased
          ? [
              ["lookalikeValue", "Customer value", "Non-negative number; required for value-based additions."] as [
                string,
                string,
                string
              ],
            ]
          : []),
      ]),
      ...privacy(),
    ];
    if (managed)
      items.push({
        editor: "checkbox",
        name: "Exclusive management",
        value: settings.exclusiveManagementConfirmed === true,
        label: "Jitsu may remove missing members. No other user or tool will upload to this audience.",
        change: exclusiveManagementConfirmed => change({ exclusiveManagementConfirmed }),
      });
    return items.map(item => ({ ...item, group: "Stream settings" }));
  },
};
export const metaConversionEditor: ReverseStreamEditor = {
  id: "conversions",
  label: "Conversions",
  settings: MetaConversionOptions,
  defaults: () => ({ mode: "upsert", mapping: {}, streamOptions: { pixelId: "", actionSource: "website" } }),
  fields(options) {
    const { settings, change, text } = controls(options);
    const items: ReverseEditorField[] = [
      text(
        "pixelId",
        "Pixel / dataset ID",
        "Find the ID in Meta Events Manager. The destination token must have access to this data source."
      ),
      {
        editor: "notice",
        key: "insert-only",
        title: "Insert new events only",
        description:
          "Use a unique model primary key per event. Previously submitted keys are not sent again. Unknown submission outcomes require manual reconciliation; event-ID deduplication is not an unlimited replay guarantee.",
      },
      text(
        "eventName",
        "Default event name",
        "Optional when mapping Event name below. Examples: Purchase, Lead or a custom event name."
      ),
      {
        editor: "select",
        name: "Default action source",
        value: settings.actionSource ?? "website",
        choices: MetaActionSource.options.map(value => ({ value, label: value.replaceAll("_", " ") })),
        change: actionSource => change({ actionSource }),
      },
      text(
        "testEventCode",
        "Test event code",
        "Optional: shows events in Events Manager → Test Events. Meta still uses these events for targeting and measurement; this is NOT a sandbox."
      ),
      ...mappings([
        ["eventName", "Event name", "Overrides the default event name."],
        [
          "messagingChannel",
          "Messaging channel",
          "Required for business_messaging unless a default is selected: messenger, whatsapp or instagram.",
        ],
        [
          "eventTime",
          "Event time",
          "Unix seconds or ISO timestamp with timezone; defaults to extraction time when omitted.",
        ],
        [
          "eventId",
          "Event ID",
          "Optional browser/server deduplication ID; otherwise derived from the model primary key.",
        ],
        ["actionSource", "Action source", "Optional per-row override."],
        ["eventSourceUrl", "Event source URL", "Required for website events."],
      ]),
      ...contacts(),
      { editor: "identifier", raw: "externalId", hashed: "hashedExternalId", name: "External / CRM ID" },
      {
        editor: "identifier",
        raw: "dateOfBirth",
        hashed: "hashedDateOfBirth",
        name: "Date of birth",
        documentation: "YYYY-MM-DD or YYYYMMDD; hashes must be SHA-256 of YYYYMMDD.",
      },
      ...mappings([
        ["clientIpAddress", "Client IP address"],
        ["clientUserAgent", "Client user agent", "Required for website events."],
        ["fbc", "Facebook click cookie (fbc)"],
        ["fbp", "Facebook browser cookie (fbp)"],
        ["subscriptionId", "Subscription ID"],
        ["facebookLoginId", "Facebook Login ID"],
        ["leadId", "Lead ID"],
        ["mobileAdvertisingId", "Mobile advertising ID"],
        ["anonymousId", "Anonymous ID"],
        ["pageId", "Facebook Page ID"],
        ["pageScopedUserId", "Page-scoped user ID"],
        ["ctwaClid", "Click-to-WhatsApp ID"],
        [
          "whatsappBusinessAccountId",
          "WhatsApp Business Account ID",
          "Required with Click-to-WhatsApp ID for WhatsApp messaging events.",
        ],
        ["instagramAccountId", "Instagram business account ID"],
        ["instagramScopedId", "Instagram-scoped user ID"],
        ["value", "Value", "Required with currency for Purchase events."],
        ["currency", "Currency", "Three-letter ISO currency code."],
        ["orderId", "Order ID"],
        ["contentName", "Content name"],
        ["contentCategory", "Content category"],
        ["contentType", "Content type"],
        ["contentIds", "Content IDs", "Array or JSON column."],
        ["contents", "Contents", 'Array or JSON column, e.g. [{"id":"sku","quantity":1,"item_price":10}].'],
        ["numItems", "Number of items"],
        ["predictedLtv", "Predicted lifetime value"],
        ["status", "Status"],
        ["searchString", "Search string"],
        ["customData", "Additional custom data", "Object or JSON column; explicit field mappings take precedence."],
        [
          "appData",
          "App data",
          "Object or JSON column. App events require advertiser_tracking_enabled, application_tracking_enabled (0/1) and all 16 extinfo positions, starting with i2 or a2.",
        ],
        ["optOut", "Opt out", "Optional boolean; Meta's event-level opt_out flag."],
      ]),
      ...privacy(),
    ];
    if (settings.actionSource === "business_messaging")
      items.splice(3, 0, {
        editor: "select",
        name: "Default messaging channel",
        value: settings.messagingChannel,
        choices: MetaMessagingChannel.options.map(value => ({ value, label: value })),
        documentation:
          "Use the dataset connected to this messaging account. Channel-specific account and user IDs are required; Jitsu does not provision datasets.",
        change: messagingChannel => change({ messagingChannel }),
      });
    return items.map(item => ({ ...item, group: "Stream settings" }));
  },
};
export const metaAdsMetadata = {
  id: metaDestinationId,
  displayName: metaDestinationTitle,
  streams: [metaAudienceEditor, metaConversionEditor],
};
