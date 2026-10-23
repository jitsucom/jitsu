import type {
  ReverseEditorAlternative,
  ReverseEditorField,
  ReverseEditorOptions,
  ReverseStreamEditor,
} from "@jitsu/protocols/reverse-etl-editor";
import { alternative, mappingKey, settingKey, withFieldRules } from "../../reverse-etl/editor";
import {
  OpenAiActionSource,
  OpenAiAudienceOptions,
  OpenAiConversionOptions,
  OpenAiEventType,
  openAiAdsDestinationId,
  openAiAdsDestinationTitle,
} from "./reverse-meta";

const label = (value: string) => value.replaceAll("_", " ");
function mappings(fields: [string, string, string?][]): ReverseEditorField[] {
  return fields.map(([field, name, documentation]) => ({ editor: "mapping", field, name, documentation }));
}
const fixedWeb = (o: ReverseEditorOptions) =>
  !o.mapping.actionSource && (o.streamOptions.actionSource ?? "web") === "web";

export const openAiConversionEditor: ReverseStreamEditor = {
  id: "conversions",
  label: "Conversions",
  settings: OpenAiConversionOptions,
  alternatives(): ReverseEditorAlternative[] {
    return [
      {
        key: "event-type",
        title: "Event type",
        beforeRequired: true,
        description:
          "Choose a default for all events, or map a column to set it per row. Missing or null column values use the default.",
        options: [
          { label: "Default event type", fields: [settingKey("Default event type")] },
          alternative("Event type column", "eventType"),
        ],
      },
    ];
  },
  defaults: () => ({ mode: "upsert", mapping: {}, streamOptions: { pixelId: "", actionSource: "web" } }),
  fields(options) {
    const settings = options.streamOptions;
    const change = (patch: Record<string, any>) => ({ streamOptions: { ...settings, ...patch } });
    const items: ReverseEditorField[] = [
      {
        key: "pixelId",
        name: "Pixel ID",
        editor: "text",
        value: String(settings.pixelId ?? ""),
        documentation:
          "The Pixel ID of the data source in Ads Manager → Conversions. The Conversions API key on the destination must belong to the same account.",
        change: value => change({ pixelId: value || undefined }),
      },
      {
        editor: "notice",
        key: "insert-only",
        presentation: "description",
        title:
          "Only new model primary keys are sent; changes to previously sent rows are not resent. OpenAI rejects a whole batch if one event is invalid, and events must be from the last 7 days.",
      },
      {
        editor: "select",
        name: "Default event type",
        value: settings.eventType,
        documentation: "Used when Event type is not mapped or the row's value is null.",
        choices: OpenAiEventType.options.map(value => ({ value, label: label(value) })),
        change: eventType => change({ eventType }),
      },
      {
        key: "customEventName",
        name: "Default custom event name",
        editor: "text",
        value: String(settings.customEventName ?? ""),
        documentation:
          "For custom events when no column is mapped: 1-64 letters, digits, _ or -, not a standard event name.",
        change: value => change({ customEventName: value || undefined }),
      },
      {
        editor: "select",
        name: "Default action source",
        value: settings.actionSource ?? "web",
        documentation: "Used when Action source is not mapped or the row's value is null. App events need mobile_app.",
        choices: OpenAiActionSource.options.map(value => ({ value, label: label(value) })),
        change: actionSource => change({ actionSource }),
      },
      ...mappings([
        ["eventType", "Event type", "One of OpenAI's standard event names, or custom."],
        ["customEventName", "Custom event name", "Required for custom events unless a default is set."],
        ["eventId", "Event ID", "Optional deduplication ID; otherwise derived from the model primary key."],
        [
          "eventTime",
          "Event time",
          "Timestamp with a timezone (ISO, or a warehouse timestamptz such as 2026-10-21 16:30:00+05:30), or Unix milliseconds. Must be within the last 7 days and at most 10 minutes ahead; defaults to the extraction time when omitted.",
        ],
        ["actionSource", "Action source", "Optional per-row override."],
        ["sourceUrl", "Source URL", "Required for web events. Include the scheme and host."],
        ["oppref", "OpenAI click reference (oppref)", "Pass the value captured from the ad click without changes."],
        ["optOut", "Opt out", "Optional boolean: opt the event out of future user-level personalization."],
        ["amount", "Amount", "Whole number in the currency's minor unit, for example 4200 for $42.00. Needs Currency."],
        ["currency", "Currency", "Three-letter ISO 4217 code. Required with Amount."],
        ["planId", "Plan ID", "For subscription_created, trial_started and custom events."],
        [
          "contents",
          "Contents",
          'Array or JSON column, e.g. [{"id":"sku","quantity":1,"amount":1999,"currency":"USD"}]. Not allowed for customer_action events.',
        ],
      ]),
      ...(
        [
          ["email", "hashedEmail", "Email"],
          ["phone", "hashedPhone", "Phone (with country code)"],
          ["externalId", "hashedExternalId", "External / CRM ID"],
          ["firstName", "hashedFirstName", "First name"],
          ["lastName", "hashedLastName", "Last name"],
        ] as const
      ).map(
        ([raw, hashed, name]): ReverseEditorField => ({
          editor: "identifier",
          raw,
          hashed,
          name,
          documentation:
            "Supply raw values or SHA-256 hashes, not both. Raw values are normalized and hashed by Jitsu; at most 3 distinct values per event.",
        })
      ),
      ...mappings([
        ["region", "Region"],
        ["city", "City"],
        ["postalCode", "Postal code"],
        ["country", "Country (two-letter code)"],
        ["androidAdvertisingId", "Android advertising ID", "GAID as a UUID. IDFA is not supported."],
        ["obref", "OpenAI browser reference (obref)", "From the Pixel's __obref cookie."],
        ["ipAddress", "IP address"],
        ["userAgent", "User agent"],
      ]),
    ];
    return withFieldRules(items, {
      "setting:pixelId": { required: true },
      "mapping:sourceUrl": { required: fixedWeb, requirement: "Required for web rows." },
      "mapping:customEventName": { requirement: "Required for custom event rows unless a default name is set." },
      "mapping:currency": { requirement: "Required whenever Amount is mapped." },
    });
  },
};

export const openAiAudienceEditor: ReverseStreamEditor = {
  id: "audience",
  label: "Custom Audiences",
  settings: OpenAiAudienceOptions,
  alternatives(): ReverseEditorAlternative[] {
    return [
      {
        key: "member-identifier",
        title: "Member identifier",
        description:
          "Map at least one. Jitsu sends every identifier it has for a member and identifies the member by the first available of email, phone and Android advertising ID.",
        options: [
          { label: "Email", fields: [mappingKey("email")] },
          { label: "Phone", fields: [mappingKey("phone")] },
          { label: "Android advertising ID", fields: [mappingKey("gaid")] },
        ],
      },
    ];
  },
  defaults: () => ({
    mode: "mirror",
    mapping: {},
    streamOptions: { audience: { kind: "managed", name: "" }, exclusiveManagementConfirmed: false },
  }),
  fields(options) {
    const settings = options.streamOptions;
    const change = (patch: Record<string, any>) => ({ streamOptions: { ...settings, ...patch } });
    const audience = settings.audience ?? { kind: "managed", name: "" };
    const managed = audience.kind === "managed";
    const items: ReverseEditorField[] = [
      {
        editor: "select",
        name: "Audience",
        value: audience.kind,
        documentation:
          (managed
            ? "Mirror: adds new members first, then removes tracked members that are no longer in the model."
            : "Additions and explicit removals via a model delete column. Existing members are not imported or cleared; mirroring is not supported for an existing audience.") +
          " Empty and small audiences can only be used to exclude people; inclusion and bid adjustments need roughly 25,000 matched users. Custom audiences are not available for campaigns targeting the EEA or Switzerland.",
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
          ? "At least three characters. Created by the runner on the first run, not when saving this form."
          : "The ID of a customer-list audience in this ad account, for example caud_... (Ads Manager, Audiences).",
        change: value => change({ audience: { ...audience, [managed ? "name" : "audienceId"]: value } }),
      },
      ...(managed
        ? [
            {
              editor: "notice" as const,
              key: "audience-mode",
              presentation: "warning" as const,
              showIcon: true,
              title:
                "Tracked members missing from the model are removed. An empty model clears tracked membership. Changing a member's email can remove them, because OpenAI matches people, not identifiers. Members who share a phone or email are removed together.",
            },
          ]
        : []),
      ...(
        [
          ["email", "hashedEmail", "Email"],
          ["phone", "hashedPhone", "Phone (with country code)"],
        ] as const
      ).map(
        ([raw, hashed, name]): ReverseEditorField => ({
          editor: "identifier",
          raw,
          hashed,
          name,
          documentation:
            raw === "phone"
              ? "Supply raw values or SHA-256 hashes, not both. A raw phone needs its country code; the hash is of the E.164 number including the +."
              : "Supply raw values or SHA-256 hashes, not both. Raw values are trimmed, lowercased and hashed by Jitsu; dots and plus tags are kept. One value per member.",
        })
      ),
      ...mappings([
        [
          "gaid",
          "Android advertising ID",
          "A raw, hyphenated, non-zero Google Advertising ID. Do not hash it; OpenAI hashes it. IDFA is not supported.",
        ],
      ]),
    ];
    if (managed)
      items.push({
        editor: "checkbox",
        name: "Exclusive management",
        value: settings.exclusiveManagementConfirmed === true,
        label: "Jitsu may remove missing members. No other user or tool will change this audience.",
        change: exclusiveManagementConfirmed => change({ exclusiveManagementConfirmed }),
      });
    return withFieldRules(
      items,
      Object.fromEntries(
        ["Audience", managed ? "Audience name" : "Audience ID", ...(managed ? ["Exclusive management"] : [])].map(
          name => [`setting:${name}`, { required: true }]
        )
      )
    );
  },
};

export const openAiAdsMetadata = {
  id: openAiAdsDestinationId,
  displayName: openAiAdsDestinationTitle,
  streams: [openAiConversionEditor, openAiAudienceEditor],
};
