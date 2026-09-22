import type {
  ReverseEditorField,
  ReverseEditorOptions,
  ReverseEditorPatch,
  ReverseStreamEditor,
} from "@jitsu/protocols/reverse-etl-editor";
import type { z } from "zod";
import { GoogleAudienceRow, GoogleAudienceSettings } from "./meta";
type Key = keyof z.input<typeof GoogleAudienceRow>;
type Field = ReverseEditorField<Key>;

export const googleAudienceEditor: ReverseStreamEditor = {
  id: "audience",
  label: "Audience",
  settings: GoogleAudienceSettings,
  defaults: () => ({
    mode: "mirror",
    mapping: {},
    streamOptions: {
      audience: { kind: "managed", displayName: "" },
      mirrorStrategy: "snapshot-diff",
      customerMatchTermsAccepted: false,
      exclusiveManagementConfirmed: false,
    },
  }),
  fields(options: ReverseEditorOptions) {
    const settings = options.streamOptions;
    // Preserve the interpretation of legacy links without rewriting their saved data.
    const target = settings.audience as { kind: string; displayName?: string; audienceId?: string } | undefined;
    const kind = target?.kind ?? (settings.managedAudienceId ? "managed" : "existing");
    const change = (patch: Record<string, unknown>): ReverseEditorPatch => ({
      streamOptions: { ...settings, ...patch },
    });
    const items: Field[] = [
      {
        name: "Audience",
        editor: "select",
        value: kind,
        documentation:
          "New audiences are created by the runner on the first run. Existing audiences use their numeric Google Ads user-list ID.",
        choices: [
          { value: "managed", label: "Create a new audience on first run" },
          { value: "existing", label: "Use an existing audience" },
        ],
        change: kind => ({
          mode: kind === "managed" ? "mirror" : "upsert",
          streamOptions: {
            customerMatchTermsAccepted: settings.customerMatchTermsAccepted,
            audience: kind === "managed" ? { kind, displayName: "" } : { kind, audienceId: "" },
            ...(kind === "managed" ? { mirrorStrategy: "snapshot-diff" } : {}),
          },
        }),
      },
      kind !== "managed"
        ? {
            name: "Audience ID",
            editor: "target",
            targetKind: "audience",
            value: String(target?.audienceId ?? settings.audienceId ?? ""),
            change: audienceId => change(target ? { audience: { ...target, audienceId } } : { audienceId }),
          }
        : {
            name: target ? "Audience name" : "Audience ID",
            editor: "text",
            value: String(target ? target.displayName ?? "" : settings.audienceId ?? ""),
            change: displayName => change({ audience: { ...target, displayName } }),
          },
      {
        name: "Sync mode",
        editor: "select",
        value: options.mode === "upsert" ? "upsert" : settings.mirrorStrategy ?? "snapshot-diff",
        choices: [
          ...(kind === "managed"
            ? [{ value: "snapshot-diff", label: "Mirror — changes only" }]
            : [{ value: "upsert", label: "Additions and explicit removals" }]),
          { value: "full-replace", label: "Mirror — full audience replacement" },
        ],
        change: value => {
          const { mirrorStrategy, exclusiveManagementConfirmed, ...rest } = settings;
          return {
            mode: value === "upsert" ? "upsert" : "mirror",
            streamOptions: { ...rest, ...(value !== "upsert" ? { mirrorStrategy: value } : {}) },
          };
        },
      },
      {
        name: "Identifier type",
        editor: "select",
        value: settings.identifierType ?? "CONTACT_INFO",
        documentation:
          "Choose the type of identifiers accepted by the target audience. Existing audience types cannot be changed.",
        choices: [
          { value: "CONTACT_INFO", label: "Contact information" },
          { value: "MOBILE_ADVERTISING_ID", label: "Mobile advertising IDs" },
          { value: "CRM_ID", label: "CRM IDs" },
        ],
        change: identifierType => ({
          ...change({ identifierType }),
          mapping: Object.fromEntries(
            Object.entries(options.mapping).filter(([key]) => ["adUserData", "adPersonalization"].includes(key))
          ),
        }),
      },
    ];
    if (kind === "managed")
      items.push({
        name: "Membership duration (days)",
        editor: "number",
        value: Number(settings.membershipDays ?? 540),
        min: 1,
        max: 540,
        documentation: "Optional; defaults to 540 days. Normal mirror runs refresh memberships before expiry.",
        change: value => change({ membershipDays: value ?? undefined }),
      });
    if (settings.identifierType === "MOBILE_ADVERTISING_ID")
      items.push(
        {
          name: "App ID",
          editor: "text",
          value: String(settings.appId ?? ""),
          documentation:
            "The iOS application ID or Android package name. Required to create a new mobile audience; optional for an existing audience.",
          change: appId => change({ appId: appId || undefined }),
        },
        {
          name: "Mobile platform",
          editor: "select",
          value: settings.mobilePlatform,
          documentation: "Required to create a new mobile audience; optional for an existing audience.",
          choices: [
            { value: "IOS", label: "iOS" },
            { value: "ANDROID", label: "Android" },
          ],
          change: mobilePlatform => change({ mobilePlatform }),
        }
      );
    if (options.mode === "mirror")
      items.push({
        key: "mirror-notice",
        editor: "notice",
        showIcon: true,
        title:
          settings.mirrorStrategy === "full-replace"
            ? "Every member is uploaded; older membership is removed after Google accepts all uploads."
            : "Only changed members are uploaded; missing members are removed after uploads succeed.",
        description:
          "An empty model clears the audience. Use a full-query model and do not upload to this audience from other tools.",
      });
    if (!settings.identifierType || settings.identifierType === "CONTACT_INFO") {
      for (const [name, raw, hashed] of [
        ["Email", "email", "hashedEmail"],
        ["Phone", "phone", "hashedPhone"],
        ["First name", "firstName", "hashedFirstName"],
        ["Last name", "lastName", "hashedLastName"],
      ] as const)
        items.push({
          name: name + " column",
          editor: "identifier",
          raw,
          hashed,
          documentation:
            "Optional. Email and phone accept a string or array. Names are only needed for address matching.",
        });
    }
    const columns: [Key, string, string][] =
      settings.identifierType === "CRM_ID"
        ? [["crmId", "CRM ID", "Advertiser-assigned user identifier."]]
        : settings.identifierType === "MOBILE_ADVERTISING_ID"
        ? [["mobileAdvertisingId", "Mobile advertising ID", "Advertising ID/IDFA string or array."]]
        : [
            [
              "phoneCountryCode",
              "Phone country code",
              "Optional dialing code for raw phone numbers without a leading country code.",
            ],
            [
              "countryCode",
              "Address country code",
              "Optional. Two-letter country code; used with first name, last name and postal code.",
            ],
            ["postalCode", "Postal code", "Optional; used for address matching."],
          ];
    for (const [field, name, documentation] of columns) items.push({ editor: "mapping", field, name, documentation });
    for (const [field, name] of [
      ["adUserData", "Ad user data consent column"],
      ["adPersonalization", "Ad personalization consent column"],
    ] as const)
      items.push({
        editor: "mapping",
        field,
        name,
        documentation: "Optional. Unmapped consent defaults to GRANTED; mapped values are checked during the run.",
      });
    items.push({
      name: "Customer Match terms",
      editor: "checkbox",
      value: settings.customerMatchTermsAccepted === true,
      label: "I accept Google's Customer Match terms.",
      change: customerMatchTermsAccepted => change({ customerMatchTermsAccepted }),
    });
    if (options.mode === "mirror")
      items.push({
        name: "Exclusive management",
        editor: "checkbox",
        value: settings.exclusiveManagementConfirmed === true || (!target && !!settings.managedAudienceId),
        label: "Jitsu may remove members absent from the model. No other tool or user will upload to this audience.",
        change: value => change({ exclusiveManagementConfirmed: value || undefined }),
      });
    return items.map(item => ({ ...item, group: "Stream settings" }));
  },
};
