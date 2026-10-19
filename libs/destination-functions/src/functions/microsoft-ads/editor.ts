import type { ReverseEditorField, ReverseStreamEditor } from "@jitsu/protocols/reverse-etl-editor";
import { MicrosoftAudienceOptions, MicrosoftConversionOptions } from "./meta";
import { alternative, withFieldRules } from "../../reverse-etl/editor";

const audience: ReverseStreamEditor = {
  id: "audience",
  label: "Customer Match audiences",
  settings: MicrosoftAudienceOptions,
  defaults: () => ({
    mode: "mirror",
    mapping: {},
    streamOptions: {
      audience: { kind: "managed", name: "" },
      acceptCustomerMatchTerms: false,
      exclusiveManagementConfirmed: false,
    },
  }),
  fields({ streamOptions: settings }) {
    const target = settings.audience ?? { kind: "managed", name: "" };
    const managed = target.kind === "managed";
    const change = (patch: object) => ({ streamOptions: { ...settings, ...patch } });
    const fields: ReverseEditorField[] = [
      {
        editor: "select",
        name: "Audience",
        value: target.kind,
        documentation: managed
          ? "Mirror — changes only: uploads additions before removing tracked members absent from the full model."
          : "Additions and explicit removals via a model delete column. Other audience members are untouched.",
        choices: [
          { value: "managed", label: "Create a new audience on first run" },
          { value: "existing", label: "Use an existing audience" },
        ],
        change: kind => ({
          mode: kind === "managed" ? "mirror" : "upsert",
          ...change({
            audience: kind === "managed" ? { kind, name: "" } : { kind, audienceId: "" },
            exclusiveManagementConfirmed: false,
          }),
        }),
      },
      {
        editor: managed ? "text" : "target",
        targetKind: "microsoft-audience",
        name: managed ? "Audience name" : "Audience ID",
        value: managed ? target.name ?? "" : target.audienceId ?? "",
        documentation: managed
          ? "Created on the first run. Account-scoped, with no automatic membership expiration."
          : "Numeric Customer Match audience ID. Existing members are not imported or cleared.",
        change: value => change({ audience: { ...target, [managed ? "name" : "audienceId"]: value } }),
      },
      {
        editor: "identifier",
        raw: "email",
        hashed: "hashedEmail",
        name: "Email",
        documentation:
          "Required. Raw email is trimmed and lowercased before SHA-256 hashing. Phone and CRM IDs are not supported for Customer Match.",
      },
      {
        editor: "checkbox",
        name: "Customer Match terms",
        value: settings.acceptCustomerMatchTerms === true,
        label: "I accept Microsoft Customer Match terms and confirm I may lawfully disclose this customer data.",
        documentation:
          "Optional if already accepted in Microsoft Advertising. See https://help.ads.microsoft.com/apex/index/3/en/56921",
        change: acceptCustomerMatchTerms => change({ acceptCustomerMatchTerms }),
      },
      ...(managed
        ? [
            {
              editor: "notice" as const,
              key: "mode",
              presentation: "warning" as const,
              showIcon: true,
              title: "Tracked members missing from the model are removed. An empty model clears tracked membership.",
            },
          ]
        : []),
    ];
    if (managed)
      fields.push({
        editor: "checkbox",
        name: "Exclusive management",
        value: settings.exclusiveManagementConfirmed === true,
        label: "Only Jitsu will manage this audience; Jitsu may remove members absent from the model.",
        change: exclusiveManagementConfirmed => change({ exclusiveManagementConfirmed }),
      });
    return withFieldRules(fields, {
      ...Object.fromEntries(
        ["Audience", "Audience name", "Audience ID", "Exclusive management"].map(name => [
          `setting:${name}`,
          { required: true },
        ])
      ),
      "mapping:email": { required: true },
    });
  },
};
const conversions: ReverseStreamEditor = {
  id: "offline-conversions",
  label: "Offline conversions",
  settings: MicrosoftConversionOptions,
  alternatives: () => [
    {
      key: "matching",
      title: "Conversion matching",
      description:
        "Provide at least one matching option for every conversion. Email and phone are for enhanced conversions.",
      options: [
        alternative("Microsoft click ID", "microsoftClickId"),
        alternative("Email (raw or SHA-256)", "email"),
        alternative("Phone (raw or SHA-256)", "phone"),
      ],
    },
  ],
  defaults: () => ({ mode: "upsert", mapping: {}, streamOptions: { conversionName: "" } }),
  fields({ streamOptions }) {
    const fields: ReverseEditorField[] = [
      {
        editor: "target",
        targetKind: "microsoft-goal",
        name: "Conversion goal name",
        value: streamOptions.conversionName ?? "",
        change: conversionName => ({ streamOptions: { conversionName } }),
        documentation:
          "Exact name of an existing Offline conversion goal, created at least two hours before upload. No UET tag is needed.",
      },
      {
        editor: "notice",
        key: "insert",
        presentation: "description",
        title: "Only new model primary keys are sent; changes to previously sent rows are not resent.",
      },
      {
        editor: "mapping",
        name: "Conversion time",
        field: "conversionTime",
        documentation:
          "Required ISO timestamp with timezone; within the last 90 days. Also must satisfy Microsoft's click/conversion window.",
      },
      {
        editor: "mapping",
        name: "Microsoft click ID",
        field: "microsoftClickId",
        documentation: "MSCLKID. Optional when email or phone is supplied for enhanced conversions.",
      },
      { editor: "identifier", name: "Email", raw: "email", hashed: "hashedEmail" },
      {
        editor: "identifier",
        name: "Phone",
        raw: "phone",
        hashed: "hashedPhone",
        documentation:
          "Raw phone must include country code, e.g. +14155552671. SHA-256 inputs must hash the E.164 value.",
      },
      ...[
        ["conversionValue", "Conversion value"],
        ["currency", "Currency (ISO 4217)"],
        ["externalAttributionCredit", "External attribution credit"],
        ["externalAttributionModel", "External attribution model"],
      ].map(
        ([field, name]): ReverseEditorField => ({
          editor: "mapping",
          field,
          name,
          documentation: field.startsWith("external")
            ? "Optional pair, only for goals configured for external attribution."
            : "Optional; otherwise Microsoft's goal default applies.",
        })
      ),
    ];
    return withFieldRules(fields, {
      "setting:Conversion goal name": { required: true },
      "mapping:conversionTime": { required: true },
      "mapping:externalAttributionCredit": {
        required: o => !!o.mapping.externalAttributionModel,
        requirement: "Required with external attribution model; only for goals configured for external attribution.",
      },
      "mapping:externalAttributionModel": {
        required: o => !!o.mapping.externalAttributionCredit,
        requirement: "Required with external attribution credit; only for goals configured for external attribution.",
      },
    });
  },
};
export const microsoftAdsMetadata = {
  id: "microsoft-ads",
  displayName: "Microsoft Advertising (Bing Ads)",
  streams: [audience, conversions],
};
