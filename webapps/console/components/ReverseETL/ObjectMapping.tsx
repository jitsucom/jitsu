import React, { useState } from "react";
import { Button, Input, Radio } from "antd";
import type { ReverseEditorField, ReverseEditorOptions, ReverseEditorPatch } from "@jitsu/protocols/reverse-etl-editor";
import styles from "../FieldListEditorLayout/FieldListEditorLayout.module.css";

function MappingRow({
  label,
  children,
  compact = false,
}: {
  label: React.ReactNode;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`${styles.editorItemRow} !border-0 ${compact ? "min-h-10" : ""}`}>
      <div className={`${styles.name} ${compact ? "!py-1 !items-center" : ""}`}>{label}</div>
      <div className={`${styles.component} ${compact ? "!py-1" : ""}`}>{children}</div>
    </div>
  );
}

type ObjectField = Extract<ReverseEditorField, { editor: "mapping" }>;
export function ObjectMapping({
  field,
  options,
  update,
  disabled,
  selector,
  showValidation,
}: {
  field: ObjectField;
  options: ReverseEditorOptions;
  update(patch: ReverseEditorPatch): void;
  disabled: boolean;
  showValidation?: boolean;
  selector(label: string, value: string | undefined, change: (value: string) => void): React.ReactNode;
}) {
  const [property, setProperty] = useState("");
  const [column, setColumn] = useState("");
  const compose = Object.hasOwn(options.objectMappings ?? {}, field.field);
  const properties = options.objectMappings?.[field.field] ?? {};
  const definition = field.object!;
  const fixed = definition.properties ?? [];
  const commit = (next: Record<string, string>) => {
    const mapping = { ...options.mapping };
    delete mapping[field.field];
    update({ mapping, objectMappings: { ...options.objectMappings, [field.field]: next } });
  };
  const set = (key: string, value: string) => {
    const next = { ...properties };
    if (value) Object.defineProperty(next, key, { value, enumerable: true, configurable: true, writable: true });
    else delete next[key];
    commit(next);
  };
  const validProperty =
    !!property.trim() &&
    property === property.trim() &&
    property.length <= 128 &&
    !property.includes("\0") &&
    !["__proto__", "constructor", "prototype"].includes(property) &&
    !Object.hasOwn(properties, property) &&
    !fixed.some(p => p.key === property);
  return (
    <div>
      <Radio.Group
        className="flex flex-col w-full py-3"
        aria-label={`${field.name} mapping mode`}
        value={compose ? "compose" : "column"}
        disabled={disabled}
        onChange={event => {
          if (event.target.value === "compose") commit({});
          else {
            const objectMappings = { ...options.objectMappings };
            delete objectMappings[field.field];
            update({ objectMappings: Object.keys(objectMappings).length ? objectMappings : undefined });
          }
        }}
      >
        <MappingRow compact label={<Radio value="column">Model column</Radio>}>
          {!compose &&
            selector(field.name ?? field.field, options.mapping[field.field], value => {
              const mapping = { ...options.mapping };
              if (value) mapping[field.field] = value;
              else delete mapping[field.field];
              update({ mapping });
            })}
        </MappingRow>
        <MappingRow compact label={<Radio value="compose">Compose object</Radio>} />
      </Radio.Group>
      {compose && (
        <>
          {[
            ...fixed,
            ...Object.keys(properties)
              .filter(key => !fixed.some(p => p.key === key))
              .map(key => ({ key, name: key, required: false, documentation: undefined })),
          ].map(p => (
            <MappingRow
              key={p.key}
              label={
                <div className="pl-6 pr-2 break-all">
                  {p.name}
                  {p.required && <span className="text-red-500 ml-1">*</span>}
                </div>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                {selector(`${field.name}: ${p.name}`, properties[p.key], value => set(p.key, value))}
                {!fixed.some(f => f.key === p.key) && (
                  <Button disabled={disabled} onClick={() => set(p.key, "")}>
                    Remove
                  </Button>
                )}
              </div>
              {p.documentation && <div className="text-xs text-textSecondary">{p.documentation}</div>}
              {showValidation && p.required && !properties[p.key] && (
                <div className="text-sm text-red-600">Map this required property.</div>
              )}
            </MappingRow>
          ))}
          {definition.additionalProperties && (
            <MappingRow
              label={
                <div className="pl-6">
                  <Input
                    className="w-52"
                    aria-label={`${field.name} new property name`}
                    placeholder="Property name"
                    disabled={disabled}
                    value={property}
                    maxLength={128}
                    onChange={e => setProperty(e.target.value)}
                  />
                </div>
              }
            >
              <div className="flex flex-wrap gap-2 items-center">
                {selector(`${field.name} new property column`, column, setColumn)}
                <Button
                  disabled={disabled || !validProperty || !column || Object.keys(properties).length >= 100}
                  onClick={() => {
                    set(property, column);
                    setProperty("");
                    setColumn("");
                  }}
                >
                  Add property
                </Button>
              </div>
              {property && !validProperty && (
                <div className="text-sm text-red-600">
                  Use a unique, non-empty property name without surrounding spaces or reserved names.
                </div>
              )}
            </MappingRow>
          )}
          {!Object.keys(properties).length && (
            <MappingRow label={null}>
              <div className="text-sm text-textSecondary">
                No properties mapped yet. An empty optional object is not sent.
              </div>
            </MappingRow>
          )}
        </>
      )}
    </div>
  );
}
