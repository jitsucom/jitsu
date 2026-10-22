import React, { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, Select, Tag, Tooltip } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import type { ReverseEditorField } from "@jitsu/protocols/reverse-etl-editor";
import { missingStreamRequirements, resolveStreamEditor } from "@jitsu/destination-functions/src/reverse-etl/editor";
import type { ReverseSyncOptions, WarehouseColumn } from "@jitsu/warehouse-query/src/schema";
import type { EditorItem } from "../FieldListEditorLayout/FieldListEditorLayout";
import { DestinationTargetSelector } from "./DestinationTargetSelector";
import { displayColumnType } from "../../lib/warehouse-column-type";
import { ObjectMapping } from "./ObjectMapping";
export { displayColumnType } from "../../lib/warehouse-column-type";

export interface StreamEditor {
  id: string;
  label: string;
  defaults(): Pick<ReverseSyncOptions, "mode" | "mapping" | "objectMappings" | "streamOptions" | "checkpointEvery">;
  /** True when the stream builds its mapping from the model's columns (the webhook payload), not from user choices. */
  derivesMapping(options: ReverseSyncOptions): boolean;
  fields(
    options: ReverseSyncOptions,
    update: (patch: Partial<ReverseSyncOptions>) => void,
    disabled: boolean,
    source: {
      columns: WarehouseColumn[];
      loading: boolean;
      destinationId?: string;
      destinationProtocol?: string;
      showValidation?: boolean;
    }
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
      component =
        field.presentation === "description" ? (
          <div className="text-sm text-textSecondary">
            {field.title}
            {field.description && <div>{field.description}</div>}
          </div>
        ) : (
          <Alert
            type={field.presentation === "warning" ? "warning" : "info"}
            showIcon={field.showIcon}
            title={field.title}
            description={field.description}
          />
        );
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
      if (field.object) {
        component = (
          <ObjectMapping
            field={field}
            options={options}
            update={update}
            disabled={disabled}
            showValidation={source.showValidation}
            selector={(label, value, onChange) => (
              <ColumnSelector {...source} disabled={disabled} label={label} value={value} onChange={onChange} />
            )}
          />
        );
        break;
      }
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
  const invalid = source.showValidation && field.isRequired && !field.configured && !field.isHidden;
  return {
    ...item,
    component: (
      <div
        className={`space-y-2 ${invalid ? "rounded border border-red-400 bg-red-50 p-2" : ""}`}
        aria-invalid={invalid || undefined}
      >
        {item.component}
        {invalid && <div className="text-sm text-red-600">This field is required.</div>}
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

// No enclosing table border: each requirement card supplies its own border, with hints outside the cards.
export const streamFieldGroups = { "Stream settings": { className: "pb-2" } };

function requirementCard(
  stream: string,
  key: string,
  title: string,
  description: React.ReactNode,
  fields: EditorItem[],
  status?: React.ReactNode
): EditorItem[] {
  // Draw contiguous card edges without moving controls into different React parents when requirements change.
  return [
    {
      key: `${stream}:section:${key}`,
      group: "Stream settings",
      rowClassName: `mt-5 border-x border-t border-textDisabled bg-gray-50 rounded-t-xl ${
        fields.length ? "" : "border-b rounded-b-xl"
      }`,
      itemClassName: "w-full px-5 py-4",
      component: (
        <div>
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <h3 className="font-semibold text-base m-0">{title}</h3>
            {status}
          </div>
          <div className="text-sm text-textSecondary mt-2 space-y-1">{description}</div>
        </div>
      ),
    },
    ...fields.map((field, index) => ({
      ...field,
      rowClassName: `border-x border-textDisabled bg-white ${
        index === fields.length - 1 ? "border-b rounded-b-xl" : ""
      }`,
    })),
  ];
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
          defaults: () => ({
            ...stream.defaults(),
            objectMappings: undefined,
            checkpointEvery: stream.checkpointEvery ?? 50_000,
          }),
          derivesMapping: options => stream.fields(options).some(field => field.editor === "columns"),
          fields: (options, update, disabled, source) => {
            const editorOptions = {
              ...options,
              destination: { protocol: source.destinationProtocol },
            };
            const resolved = resolveStreamEditor(stream, editorOptions);
            const missingGroups = new Set(
              source.showValidation
                ? missingStreamRequirements(stream, editorOptions).alternatives.map(group => group.key)
                : []
            );
            const render = (field: ResolvedField) =>
              renderResolvedField(field, stream.id, options, update, disabled, source);
            const notices = [...resolved.required, ...resolved.alternativeFields, ...resolved.optional].filter(
              field => field.editor === "notice"
            );
            const isObject = (field: ResolvedField) => field.editor === "mapping" && !!field.object;
            const objects = [...resolved.required, ...resolved.alternativeFields, ...resolved.optional].filter(
              isObject
            );
            const required = resolved.required.filter(field => field.editor !== "notice" && !isObject(field));
            const optional = resolved.optional.filter(field => field.editor !== "notice" && !isObject(field));
            const objectCard = (field: ResolvedField) => {
              const item = render(field);
              return requirementCard(
                stream.id,
                `object:${field.key}`,
                field.name ?? field.key,
                <>
                  {field.isRequired ? "Required object. " : ""}Map a complete object column or compose it from
                  individual model columns.
                  <div>
                    Values keep their model types, including nulls. Property names are literal, not dotted paths.
                    Switching modes replaces this mapping.
                  </div>
                  {field.documentation && <div>{field.documentation}</div>}
                </>,
                [{ ...item, name: undefined, documentation: undefined, itemClassName: "w-full" }],
                <Tooltip
                  title="“Configured” checks mappings or defaults, not the values in every model row."
                  trigger={["hover", "focus"]}
                >
                  <Tag
                    className="!m-0 cursor-help"
                    tabIndex={0}
                    icon={<InfoCircleOutlined aria-hidden="true" />}
                    color={field.configured ? "green" : field.isRequired ? "orange" : undefined}
                  >
                    {field.configured ? "Configured" : field.isRequired ? "Required" : "Optional"}
                  </Tag>
                </Tooltip>
              );
            };
            const items: EditorItem[] = notices.map(field => ({
              ...render(field),
              name: undefined,
              rowClassName: "!border-0 mb-3",
              itemClassName: "w-full",
            }));
            const selectorItems: EditorItem[] = [];
            if (required.length)
              items.push(
                ...requirementCard(
                  stream.id,
                  "required",
                  "Required fields",
                  "Complete these fields for the selected stream. Defaults are filled in where available.",
                  required.map(render)
                )
              );
            items.push(...objects.filter(field => field.isRequired && !field.isHidden).flatMap(objectCard));
            if (resolved.alternatives.length) {
              const rendered = new Set(required.map(field => field.key));
              const allFields = [...required, ...resolved.alternativeFields];
              for (const group of resolved.alternatives) {
                const keys = new Set(group.options.flatMap(option => option.fields));
                const shared = [...allFields, ...objects].filter(
                  (field, index, all) =>
                    keys.has(field.key) &&
                    (rendered.has(field.key) || isObject(field)) &&
                    all.findIndex(f => f.key === field.key) === index
                );
                const fields = resolved.alternativeFields.filter(
                  field =>
                    field.editor !== "notice" && !isObject(field) && keys.has(field.key) && !rendered.has(field.key)
                );
                for (const field of fields) rendered.add(field.key);
                (group.beforeRequired ? selectorItems : items).push(
                  ...requirementCard(
                    stream.id,
                    `alternative:${group.key}`,
                    group.title,
                    <>
                      {missingGroups.has(group.key) && (
                        <div className="rounded border border-red-400 bg-red-50 p-2 text-red-600" role="alert">
                          Configure at least one complete option in this group.
                        </div>
                      )}
                      {group.condition && <div className="font-medium text-textDark">{group.condition}</div>}
                      <div>{group.description ?? "Provide at least one matching option using the fields below."}</div>
                      {!group.description &&
                        group.options
                          .filter(option => option.fields.length > 1)
                          .map(option => <div key={option.label}>{option.label} must be mapped together.</div>)}
                      {!!shared.length && (
                        <div>
                          Also uses separately displayed fields or object groups:{" "}
                          {shared.map(field => field.name).join(", ")}.
                        </div>
                      )}
                    </>,
                    fields.map(render),
                    <Tooltip
                      title="“Configured” checks mappings or defaults, not the values in every model row."
                      trigger={["hover", "focus"]}
                    >
                      <Tag
                        className="!m-0 cursor-help"
                        tabIndex={0}
                        color={group.configured ? "green" : group.condition ? "blue" : "orange"}
                        icon={<InfoCircleOutlined aria-hidden="true" />}
                      >
                        {group.configured
                          ? "Configured"
                          : group.condition
                          ? "Required for matching rows"
                          : "Choose at least one option"}
                      </Tag>
                    </Tooltip>
                  )
                );
              }
            }
            // Defaults and their column overrides must precede the requirements they control.
            items.splice(notices.length, 0, ...selectorItems);
            items.push(...objects.filter(field => !field.isRequired || field.isHidden).flatMap(objectCard));
            if (optional.length)
              items.push(
                ...requirementCard(
                  stream.id,
                  "optional",
                  "Optional and conditional fields",
                  "Add more detail to improve matching, or map fields needed only for particular rows. Leave unused fields unmapped.",
                  optional.map(render)
                )
              );
            return items;
          },
        } satisfies StreamEditor)
    ),
  ])
);
