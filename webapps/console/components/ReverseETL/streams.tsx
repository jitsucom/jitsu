import React, { useState } from "react";
import { Alert, Checkbox, Input, InputNumber, Select } from "antd";
import {
  GoogleConversionStream,
  googleConversionLabels,
} from "@jitsu/destination-functions/src/functions/google-ads-reverse/conversion-meta";
import type { ReverseSyncOptions, WarehouseColumn } from "@jitsu/warehouse-query/src/schema";
import type { EditorItem } from "../FieldListEditorLayout/FieldListEditorLayout";
import { GoogleTargetSelector } from "./GoogleTargetSelector";

export interface StreamEditor {
  id: string;
  label: string;
  defaults(): Pick<ReverseSyncOptions, "mode" | "mapping" | "streamOptions">;
  fields(
    options: ReverseSyncOptions,
    update: (patch: Partial<ReverseSyncOptions>) => void,
    disabled: boolean,
    source: { columns: WarehouseColumn[]; loading: boolean; destinationId?: string }
  ): EditorItem[];
}
function ColumnSelector({
  value,
  onChange,
  columns,
  loading,
  disabled,
  label,
}: {
  value?: string;
  onChange: (value: string) => void;
  columns: WarehouseColumn[];
  loading: boolean;
  disabled: boolean;
  label: string;
}) {
  const choices = columns.map(column => ({ value: column.name, label: column.name, title: column.type }));
  // Never silently discard a saved mapping when inspection fails or the schema changes.
  if (value && !choices.some(column => column.value === value))
    choices.unshift({ value, label: value, title: "Saved mapping" });
  return (
    <Select
      aria-label={label}
      className="w-80"
      showSearch
      allowClear
      optionFilterProp="label"
      placeholder="Select model column"
      value={value || undefined}
      options={choices}
      loading={loading}
      disabled={disabled}
      onChange={value => onChange(value ?? "")}
    />
  );
}
function IdentifierMapping({
  raw,
  hashed,
  mapping,
  disabled,
  onChange,
  source,
}: {
  raw: string;
  hashed: string;
  mapping: Record<string, string>;
  disabled: boolean;
  onChange: (mapping: Record<string, string>) => void;
  source: { columns: WarehouseColumn[]; loading: boolean };
}) {
  const [format, setFormat] = useState(mapping[hashed] ? "hashed" : "raw");
  const value = mapping[raw] ?? mapping[hashed] ?? "";
  const change = (column: string, nextFormat = format) => {
    const next = { ...mapping };
    delete next[raw];
    delete next[hashed];
    if (column) next[nextFormat === "hashed" ? hashed : raw] = column;
    onChange(next);
  };
  return (
    <div className="flex gap-2">
      <ColumnSelector
        disabled={disabled}
        label={`${raw} column`}
        {...source}
        value={value}
        onChange={value => change(value)}
      />
      <Select
        disabled={disabled}
        className="w-28"
        value={format}
        options={[
          { value: "raw", label: "Raw" },
          { value: "hashed", label: "SHA-256" },
        ]}
        onChange={value => {
          setFormat(value);
          change(mapping[raw] ?? mapping[hashed] ?? "", value);
        }}
      />
    </div>
  );
}
const audience: StreamEditor = {
  id: "audience",
  label: "Audience",
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
  fields(options, update, disabled, source) {
    const settings = options.streamOptions;
    // Legacy migrated syncs retain their delivery configuration/revision verbatim.
    const target = settings.audience as { kind: string; displayName?: string; audienceId?: string } | undefined;
    const kind = target?.kind ?? (settings.managedAudienceId ? "managed" : "existing");
    const change = (patch: Record<string, unknown>) => update({ streamOptions: { ...settings, ...patch } });
    const items: EditorItem[] = [
      {
        name: "Audience",
        documentation:
          "New audiences are created by the runner on the first run. Existing audiences use their numeric Google Ads user-list ID.",
        component: (
          <Select
            className="w-80"
            disabled={disabled}
            value={kind}
            options={[
              { value: "managed", label: "Create a new audience on first run" },
              { value: "existing", label: "Use an existing audience" },
            ]}
            onChange={kind =>
              update({
                mode: kind === "managed" ? "mirror" : "upsert",
                streamOptions: {
                  customerMatchTermsAccepted: settings.customerMatchTermsAccepted,
                  audience: kind === "managed" ? { kind, displayName: "" } : { kind, audienceId: "" },
                  ...(kind === "managed" ? { mirrorStrategy: "snapshot-diff" } : {}),
                },
              })
            }
          />
        ),
      },
      {
        name: kind === "managed" && target ? "Audience name" : "Audience ID",
        component:
          kind !== "managed" ? (
            <GoogleTargetSelector
              destinationId={source.destinationId}
              kind="audience"
              disabled={disabled}
              value={String(target?.audienceId ?? settings.audienceId ?? "")}
              onChange={audienceId => change(target ? { audience: { ...target, audienceId } } : { audienceId })}
            />
          ) : (
            <Input
              className="w-80"
              disabled={disabled}
              value={
                kind === "managed" && target
                  ? target.displayName
                  : target?.audienceId ?? String(settings.audienceId ?? "")
              }
              onChange={e =>
                change({ audience: { ...target, [kind === "managed" ? "displayName" : "audienceId"]: e.target.value } })
              }
            />
          ),
      },
      {
        name: "Sync mode",
        component: (
          <Select
            className="w-80"
            disabled={disabled}
            value={options.mode === "upsert" ? "upsert" : settings.mirrorStrategy ?? "snapshot-diff"}
            options={[
              ...(kind === "managed"
                ? [{ value: "snapshot-diff", label: "Mirror — changes only" }]
                : [{ value: "upsert", label: "Additions and explicit removals" }]),
              { value: "full-replace", label: "Mirror — full audience replacement" },
            ]}
            onChange={value => {
              const { mirrorStrategy, exclusiveManagementConfirmed, ...rest } = settings;
              update({
                mode: value === "upsert" ? "upsert" : "mirror",
                streamOptions: { ...rest, ...(value !== "upsert" ? { mirrorStrategy: value } : {}) },
              });
            }}
          />
        ),
      },
    ];
    items.push({
      name: "Identifier type",
      documentation:
        "Choose the type of identifiers accepted by the target audience. Existing audience types cannot be changed.",
      component: (
        <Select
          className="w-80"
          disabled={disabled}
          value={settings.identifierType ?? "CONTACT_INFO"}
          options={[
            { value: "CONTACT_INFO", label: "Contact information" },
            { value: "MOBILE_ADVERTISING_ID", label: "Mobile advertising IDs" },
            { value: "CRM_ID", label: "CRM IDs" },
          ]}
          onChange={identifierType =>
            update({
              streamOptions: { ...settings, identifierType },
              mapping: Object.fromEntries(
                Object.entries(options.mapping).filter(([key]) => ["adUserData", "adPersonalization"].includes(key))
              ),
            })
          }
        />
      ),
    });
    if (kind === "managed")
      items.push({
        name: "Membership duration (days)",
        documentation: "Optional; defaults to 540 days. Normal mirror runs refresh memberships before expiry.",
        component: (
          <InputNumber
            disabled={disabled}
            min={1}
            max={540}
            value={Number(settings.membershipDays ?? 540)}
            onChange={value => change({ membershipDays: value ?? undefined })}
          />
        ),
      });
    if (settings.identifierType === "MOBILE_ADVERTISING_ID") {
      items.push(
        {
          name: "App ID",
          documentation: "The iOS application ID or Android package name associated with the audience.",
          component: (
            <Input
              className="w-80"
              disabled={disabled}
              value={String(settings.appId ?? "")}
              onChange={e => change({ appId: e.target.value || undefined })}
            />
          ),
        },
        {
          name: "Mobile platform",
          component: (
            <Select
              className="w-80"
              disabled={disabled}
              value={settings.mobilePlatform}
              options={[
                { value: "IOS", label: "iOS" },
                { value: "ANDROID", label: "Android" },
              ]}
              onChange={mobilePlatform => change({ mobilePlatform })}
            />
          ),
        }
      );
    }
    if (options.mode === "mirror")
      items.push({
        key: "mirror-notice",
        component: (
          <Alert
            type="info"
            showIcon
            title={
              settings.mirrorStrategy === "full-replace"
                ? "Every member is uploaded; older membership is removed after Google accepts all uploads."
                : "Only changed members are uploaded; missing members are removed after uploads succeed."
            }
            description="An empty model clears the audience. Use a full-query model and do not upload to this audience from other tools."
          />
        ),
      });
    for (const [name, raw, hashed] of settings.identifierType && settings.identifierType !== "CONTACT_INFO"
      ? []
      : [
          ["Email", "email", "hashedEmail"],
          ["Phone", "phone", "hashedPhone"],
          ["First name", "firstName", "hashedFirstName"],
          ["Last name", "lastName", "hashedLastName"],
        ]) {
      items.push({
        name: `${name} column`,
        documentation:
          "Optional. Email and phone accept a string or array. Names are only needed for address matching.",
        component: (
          <IdentifierMapping
            key={raw}
            raw={raw}
            hashed={hashed}
            mapping={options.mapping}
            disabled={disabled}
            source={source}
            onChange={mapping => update({ mapping })}
          />
        ),
      });
    }
    for (const [field, label, documentation] of settings.identifierType === "CRM_ID"
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
        ])
      items.push(columnField(field, label, documentation, options, update, disabled, source));
    for (const [field, label] of [
      ["adUserData", "Ad user data consent column"],
      ["adPersonalization", "Ad personalization consent column"],
    ])
      items.push({
        name: label,
        documentation: "Optional. Unmapped consent defaults to GRANTED; mapped values are checked during the run.",
        component: (
          <ColumnSelector
            label={label}
            {...source}
            disabled={disabled}
            value={options.mapping[field] ?? ""}
            onChange={value => {
              const mapping = { ...options.mapping };
              if (value) mapping[field] = value;
              else delete mapping[field];
              update({ mapping });
            }}
          />
        ),
      });
    items.push({
      name: "Customer Match terms",
      component: (
        <Checkbox
          disabled={disabled}
          checked={settings.customerMatchTermsAccepted === true}
          onChange={e => change({ customerMatchTermsAccepted: e.target.checked })}
        >
          I accept Google's Customer Match terms.
        </Checkbox>
      ),
    });
    if (options.mode === "mirror")
      items.push({
        name: "Exclusive management",
        component: (
          <Checkbox
            disabled={disabled}
            checked={settings.exclusiveManagementConfirmed === true || (!target && !!settings.managedAudienceId)}
            onChange={e => change({ exclusiveManagementConfirmed: e.target.checked || undefined })}
          >
            Jitsu may remove members absent from the model. No other tool or user will upload to this audience.
          </Checkbox>
        ),
      });
    return items.map(item => ({ ...item, group: "Stream settings" }));
  },
};
function columnField(
  field: string,
  label: string,
  documentation: string,
  options: ReverseSyncOptions,
  update: (patch: Partial<ReverseSyncOptions>) => void,
  disabled: boolean,
  source: { columns: WarehouseColumn[]; loading: boolean }
): EditorItem {
  return {
    name: label,
    documentation,
    component: (
      <ColumnSelector
        label={label}
        {...source}
        disabled={disabled}
        value={options.mapping[field]}
        onChange={value => {
          const mapping = { ...options.mapping };
          if (value) mapping[field] = value;
          else delete mapping[field];
          update({ mapping });
        }}
      />
    ),
  };
}
const conversionFields: Record<GoogleConversionStream, [string, string, string?][]> = {
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
    ["userAgent", "User agent"],
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
function conversionEditor(id: GoogleConversionStream): StreamEditor {
  return {
    id,
    label: googleConversionLabels[id],
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
    fields(options, update, disabled, source) {
      const settings = options.streamOptions;
      const change = (patch: Record<string, unknown>) => update({ streamOptions: { ...settings, ...patch } });
      const items: EditorItem[] = [
        {
          name: "Conversion action ID",
          documentation:
            "In Google Ads: Goals → Conversions → Summary → open the action. Copy ctId from the page URL. This is not your customer/account ID.",
          component: (
            <GoogleTargetSelector
              destinationId={source.destinationId}
              kind="conversion-action"
              disabled={disabled}
              value={String(settings.conversionActionId ?? "")}
              onChange={conversionActionId => change({ conversionActionId })}
            />
          ),
        },
        {
          key: "event-mode",
          component: (
            <Alert
              type="info"
              showIcon
              title="Insert new events only"
              description="Use a model primary key unique to each event. Previously submitted keys are not sent again. To correct a conversion, submit a new event through Conversion adjustments."
            />
          ),
        },
      ];
      if (id === "click-conversions")
        items.push({
          name: "Delivery API",
          component: (
            <Select
              className="w-80"
              disabled={disabled}
              value={settings.api ?? "data-manager"}
              options={[
                { value: "data-manager", label: "Data Manager (recommended)" },
                { value: "google-ads", label: "Google Ads API (eligible existing integrations)" },
              ]}
              onChange={api => change({ api })}
            />
          ),
        });
      if (id !== "click-conversions" || settings.api === "google-ads")
        items.push({
          key: "ads-api",
          component: (
            <Alert
              type="info"
              title="Google Ads API authorization"
              description="Requires the adwords OAuth scope and a developer token in destination settings or the runner's GOOGLE_ADS_DEVELOPER_TOKEN environment variable."
            />
          ),
        });
      if (id === "conversion-adjustments")
        items.push(
          {
            name: "Default adjustment type",
            component: (
              <Select
                className="w-80"
                disabled={disabled}
                value={settings.adjustmentType ?? "ENHANCEMENT"}
                options={["ENHANCEMENT", "RESTATEMENT", "RETRACTION"].map(value => ({ value, label: value }))}
                onChange={adjustmentType => change({ adjustmentType })}
              />
            ),
          },
          {
            name: "Data source",
            component: (
              <Select
                className="w-80"
                disabled={disabled}
                value={settings.dataSource ?? "FIRST_PARTY"}
                options={[
                  { value: "FIRST_PARTY", label: "First-party" },
                  { value: "THIRD_PARTY", label: "Third-party" },
                ]}
                onChange={dataSource => change({ dataSource })}
              />
            ),
          }
        );
      if (id !== "call-conversions")
        for (const [label, raw, hashed] of [
          ["Email", "email", "hashedEmail"],
          ["Phone", "phone", "hashedPhone"],
          ["First name", "firstName", "hashedFirstName"],
          ["Last name", "lastName", "hashedLastName"],
          ...(id === "conversion-adjustments" ? [["Street address", "streetAddress", "hashedStreetAddress"]] : []),
        ])
          items.push({
            name: label,
            documentation: "Optional. Choose raw or SHA-256. Email and phone can contain arrays.",
            component: (
              <IdentifierMapping
                key={`${id}-${raw}`}
                raw={raw}
                hashed={hashed}
                mapping={options.mapping}
                disabled={disabled}
                source={source}
                onChange={mapping => update({ mapping })}
              />
            ),
          });
      for (const [field, label, help] of conversionFields[id])
        items.push(
          columnField(field, label, help ?? "Optional; leave unmapped if not used.", options, update, disabled, source)
        );
      return items.map(item => ({ ...item, group: "Stream settings" }));
    },
  };
}
/** Destination stream registry: adding a stream doesn't require another wizard or page. */
export const reverseStreamEditors: Record<string, StreamEditor[]> = {
  "google-ads": [audience, ...GoogleConversionStream.options.map(conversionEditor)],
};
