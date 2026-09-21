import React, { useState } from "react";
import { Alert, Checkbox, Input, Select } from "antd";
import type { ReverseSyncOptions, WarehouseColumn } from "@jitsu/warehouse-query/src/schema";
import type { EditorItem } from "../FieldListEditorLayout/FieldListEditorLayout";

export interface StreamEditor {
  id: string;
  label: string;
  defaults(): Pick<ReverseSyncOptions, "mode" | "mapping" | "streamOptions">;
  fields(
    options: ReverseSyncOptions,
    update: (patch: Partial<ReverseSyncOptions>) => void,
    disabled: boolean,
    source: { columns: WarehouseColumn[]; loading: boolean }
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
        component: (
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
    for (const [name, raw, hashed] of [
      ["Email", "email", "hashedEmail"],
      ["Phone", "phone", "hashedPhone"],
    ]) {
      items.push({
        name: `${name} column`,
        documentation: "Choose a model output column. Leave unused identifiers blank.",
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
/** Destination stream registry: adding a stream doesn't require another wizard or page. */
export const reverseStreamEditors: Record<string, StreamEditor[]> = { "google-ads": [audience] };
