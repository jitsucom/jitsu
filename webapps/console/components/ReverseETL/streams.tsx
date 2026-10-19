import React, { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, Select, Tag } from "antd";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import type { ReverseEditorField } from "@jitsu/protocols/reverse-etl-editor";
import { resolveStreamEditor } from "@jitsu/destination-functions/src/reverse-etl/editor";
import type { ReverseSyncOptions, WarehouseColumn } from "@jitsu/warehouse-query/src/schema";
import type { EditorItem } from "../FieldListEditorLayout/FieldListEditorLayout";
import { DestinationTargetSelector } from "./DestinationTargetSelector";

export interface StreamEditor {
  id: string;
  label: string;
  defaults(): Pick<ReverseSyncOptions, "mode" | "mapping" | "streamOptions" | "checkpointEvery">;
  /** True when the stream builds its mapping from the model's columns (the webhook payload), not from user choices. */
  derivesMapping(options: ReverseSyncOptions): boolean;
  fields(
    options: ReverseSyncOptions,
    update: (patch: Partial<ReverseSyncOptions>) => void,
    disabled: boolean,
    source: { columns: WarehouseColumn[]; loading: boolean; destinationId?: string; destinationProtocol?: string }
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
  const [emptyFormat, setFormat] = useState(mapping[hashed] ? "hashed" : "raw");
  const format = mapping[hashed] ? "hashed" : mapping[raw] ? "raw" : emptyFormat;
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

// Postgres reports a column's type as its numeric type ID; ClickHouse and BigQuery report names.
const postgresTypeNames: Record<string, string> = {
  "16": "bool",
  "17": "bytea",
  "20": "int8",
  "21": "int2",
  "23": "int4",
  "25": "text",
  "114": "json",
  "700": "float4",
  "701": "float8",
  "1042": "char",
  "1043": "varchar",
  "1082": "date",
  "1083": "time",
  "1114": "timestamp",
  "1184": "timestamptz",
  "1186": "interval",
  "1700": "numeric",
  "2950": "uuid",
  "3802": "jsonb",
};
/** A readable type name, or nothing for a numeric type ID we cannot name (never show the bare number). */
export function displayColumnType(type: string): string {
  return /^\d+$/.test(type) ? postgresTypeNames[type] ?? "" : type;
}
const sameMapping = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
};
/**
 * Webhook payload: every model column goes out under its own name, so the mapping is the identity over the model's
 * columns and is kept in step with them here. A column list that failed to load never overwrites a saved mapping.
 */
function PayloadColumns({
  mapping,
  disabled,
  source,
  onChange,
}: {
  mapping: Record<string, string>;
  disabled: boolean;
  source: { columns: WarehouseColumn[]; loading: boolean };
  onChange: (mapping: Record<string, string>) => void;
}) {
  const { columns, loading } = source;
  useEffect(() => {
    if (disabled || loading || !columns.length) return;
    const identity = Object.fromEntries(columns.map(column => [column.name, column.name]));
    if (!sameMapping(identity, mapping)) onChange(identity);
  }, [columns, loading, disabled, mapping, onChange]);
  const shown = columns.length
    ? columns.map(column => [column.name, displayColumnType(column.type)])
    : Object.keys(mapping).map(n => [n, ""]);
  if (!shown.length) return <Alert type="warning" title="Select a model to see the columns that will be sent." />;
  return (
    <pre className="text-xs bg-gray-50 border rounded p-3 m-0 overflow-auto max-h-80" aria-label="Payload preview">
      {`{\n${shown.map(([name, type]) => `  ${JSON.stringify(name)}: ${type ? `<${type}>` : "..."}`).join(",\n")}\n}`}
    </pre>
  );
}

function renderField(
  field: ReverseEditorField,
  streamId: string,
  options: ReverseSyncOptions,
  update: (patch: Partial<ReverseSyncOptions>) => void,
  disabled: boolean,
  source: Parameters<StreamEditor["fields"]>[3]
): EditorItem {
  let component: React.ReactNode;
  switch (field.editor) {
    case "text":
      component = (
        <Input
          className="w-80"
          disabled={disabled}
          value={field.value}
          onChange={e => update(field.change(e.target.value))}
        />
      );
      break;
    case "target":
      component = (
        <DestinationTargetSelector
          destinationId={source.destinationId}
          kind={field.targetKind}
          lookupParams={field.lookupParams}
          disabled={disabled}
          value={field.value}
          onChange={value => update(field.change(value))}
        />
      );
      break;
    case "select":
      component = (
        <Select
          className="w-80"
          disabled={disabled}
          value={field.value}
          options={field.choices}
          onChange={value => update(field.change(value))}
        />
      );
      break;
    case "number":
      component = (
        <InputNumber
          disabled={disabled}
          value={field.value}
          min={field.min}
          max={field.max}
          onChange={value => update(field.change(value))}
        />
      );
      break;
    case "checkbox":
      component = (
        <Checkbox disabled={disabled} checked={field.value} onChange={e => update(field.change(e.target.checked))}>
          {field.label}
        </Checkbox>
      );
      break;
    case "notice":
      component = <Alert type="info" showIcon={field.showIcon} title={field.title} description={field.description} />;
      break;
    case "identifier":
      component = (
        <IdentifierMapping
          key={`${streamId}-${field.raw}`}
          raw={field.raw}
          hashed={field.hashed}
          mapping={options.mapping}
          disabled={disabled}
          source={source}
          onChange={mapping => update({ mapping })}
        />
      );
      break;
    case "columns":
      component = (
        <PayloadColumns
          mapping={options.mapping}
          disabled={disabled}
          source={source}
          onChange={mapping => update({ mapping })}
        />
      );
      break;
    case "mapping":
      component = (
        <ColumnSelector
          {...source}
          disabled={disabled}
          label={field.name ?? field.field}
          value={options.mapping[field.field]}
          onChange={value => {
            const mapping = { ...options.mapping };
            if (value) mapping[field.field] = value;
            else delete mapping[field.field];
            update({ mapping });
          }}
        />
      );
      break;
  }
  return {
    key: `${streamId}:${field.key}`,
    name: field.name,
    documentation: field.documentation,
    group: "Stream settings",
    component,
  };
}

type ResolvedField = ReturnType<typeof resolveStreamEditor>["required"][number];
function renderResolvedField(
  field: ResolvedField,
  streamId: string,
  options: ReverseSyncOptions,
  update: (patch: Partial<ReverseSyncOptions>) => void,
  disabled: boolean,
  source: Parameters<StreamEditor["fields"]>[3]
): EditorItem {
  const item = renderField(field, streamId, options, update, disabled, source);
  return {
    ...item,
    component: (
      <div className="space-y-2">
        {item.component}
        {field.requirement && <div className="text-xs text-textSecondary max-w-xl">{field.requirement}</div>}
        {field.isHidden && (
          <Alert
            type="warning"
            title="This mapping does not apply to the current selection."
            description="It is still saved. Clear it or change the selection before running the sync."
            action={
              <Button
                size="small"
                disabled={disabled}
                onClick={() => {
                  const mapping = { ...options.mapping };
                  if (field.editor === "mapping") delete mapping[field.field];
                  if (field.editor === "identifier") {
                    delete mapping[field.raw];
                    delete mapping[field.hashed];
                  }
                  update({ mapping });
                }}
              >
                Clear mapping
              </Button>
            }
          />
        )}
      </div>
    ),
  };
}

function section(stream: string, key: string, component: React.ReactNode): EditorItem {
  return { key: `${stream}:section:${key}`, group: "Stream settings", component, itemClassName: "w-full px-4 py-3" };
}

/** Console owns rendering; destination packages own settings and mapping descriptions. */
export const reverseStreamEditors: Record<string, StreamEditor[]> = Object.fromEntries(
  [...reverseDestinationMetadata].map(([destination, metadata]) => [
    destination,
    metadata.streams.map(
      stream =>
        ({
          id: stream.id,
          label: stream.label,
          defaults: () => ({ ...stream.defaults(), checkpointEvery: stream.checkpointEvery ?? 50_000 }),
          derivesMapping: options => stream.fields(options).some(field => field.editor === "columns"),
          fields: (options, update, disabled, source) => {
            const resolved = resolveStreamEditor(stream, {
              ...options,
              destination: { protocol: source.destinationProtocol },
            });
            const render = (field: ResolvedField) =>
              renderResolvedField(field, stream.id, options, update, disabled, source);
            // One parent and stable field keys preserve focus/format when selector changes reorder sections.
            const items: EditorItem[] = [];
            if (resolved.required.length)
              items.push(
                section(stream.id, "required", <h3 className="font-semibold text-base m-0">Required fields</h3>),
                ...resolved.required.map(render)
              );
            if (resolved.alternatives.length) {
              items.push(
                section(
                  stream.id,
                  "alternatives",
                  <div>
                    <h3 className="font-semibold text-base m-0">Required alternatives</h3>
                    <p className="text-xs text-textSecondary mt-1 mb-0">
                      Choose at least one option in each applicable group. “Configured” checks mappings or defaults, not
                      the values in every model row.
                    </p>
                  </div>
                )
              );
              const rendered = new Set(resolved.required.map(field => field.key));
              for (const group of resolved.alternatives) {
                items.push(
                  section(
                    stream.id,
                    `alternative:${group.key}`,
                    <div className="border rounded p-3 bg-gray-50">
                      <div className="flex flex-wrap gap-2 items-center font-medium">
                        {group.title}
                        <Tag color={group.configured ? "green" : group.condition ? "blue" : "orange"}>
                          {group.configured
                            ? "Configured"
                            : group.condition
                            ? "Required for matching rows"
                            : "Choose at least one option"}
                        </Tag>
                      </div>
                      {group.condition && <p className="text-sm mt-2 mb-0">{group.condition}</p>}
                      {group.description && <p className="text-xs text-textSecondary mt-2 mb-0">{group.description}</p>}
                      <ul className="list-disc pl-5 text-sm mt-2 mb-0">
                        {group.options.map((option, index) => (
                          <li key={option.fields.join(",")}>
                            {index > 0 && <span className="font-semibold">OR </span>}
                            {option.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                );
                const keys = new Set(group.options.flatMap(option => option.fields));
                for (const field of resolved.alternativeFields)
                  if (keys.has(field.key) && !rendered.has(field.key)) {
                    items.push(render(field));
                    rendered.add(field.key);
                  }
              }
            }
            if (resolved.optional.length)
              items.push(
                section(
                  stream.id,
                  "optional",
                  <h3 className="font-semibold text-base m-0">Optional and conditional fields</h3>
                ),
                ...resolved.optional.map(render)
              );
            return items;
          },
        } satisfies StreamEditor)
    ),
  ])
);
