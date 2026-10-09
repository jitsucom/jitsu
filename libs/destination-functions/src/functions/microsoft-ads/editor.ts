import type { ReverseEditorField, ReverseStreamEditor } from "@jitsu/protocols/reverse-etl-editor";
import { MicrosoftAudienceOptions, MicrosoftConversionOptions } from "./meta";

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
        editor: "text",
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
      {
        editor: "notice",
        key: "mode",
        title: managed ? "Mirror — changes only" : "Additions and explicit removals",
        description: managed
          ? "Uploads additions before removing tracked members missing from the full model. An empty model removes all tracked members. Acceptance does not measure audience matching."
          : "Use a model delete column for explicit removals. Other audience members are untouched.",
      },
    ];
    if (managed)
      fields.push({
        editor: "checkbox",
        name: "Exclusive management",
        value: settings.exclusiveManagementConfirmed === true,
        label: "Only Jitsu will manage this audience; Jitsu may remove members absent from the model.",
        change: exclusiveManagementConfirmed => change({ exclusiveManagementConfirmed }),
      });
    return fields.map(f => ({ ...f, group: "Stream settings" }));
  },
};
const conversions: ReverseStreamEditor = {
  id: "offline-conversions",
  label: "Offline conversions",
  settings: MicrosoftConversionOptions,
  defaults: () => ({ mode: "upsert", mapping: {}, streamOptions: { conversionName: "" } }),
  fields({ streamOptions }) {
    const fields: ReverseEditorField[] = [
      {
        editor: "text",
        name: "Conversion goal name",
        value: streamOptions.conversionName ?? "",
        change: conversionName => ({ streamOptions: { conversionName } }),
        documentation:
          "Exact name of an existing Offline conversion goal, created at least two hours before upload. No UET tag is needed.",
      },
      {
        editor: "notice",
        key: "insert",
        title: "Insert new conversions only",
        description:
          "Use one stable primary key per event. Submitted keys are not sent again. Acceptance does not guarantee attribution; an uncertain submission is not automatically replayed.",
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
    return fields.map(f => ({ ...f, group: "Stream settings" }));
  },
};
export const microsoftAdsMetadata = {
  id: "microsoft-ads",
  displayName: "Microsoft Advertising (Bing Ads)",
  streams: [audience, conversions],
};
