import React, { useCallback, useMemo, useState } from "react";
import set from "lodash/set";
import get from "lodash/get";
import { EditorField } from "./EditorField";
import { Switch, Tabs } from "antd";
import { createDisplayName } from "../../lib/zod";
import Ajv from "ajv";
import { PlusIcon } from "lucide-react";
import { getLog } from "juava";
import { DateEditor, NumberEditor, PasswordEditor, SelectEditor, StringArray, TextEditor } from "./Editors";
import { Htmlizer } from "../Htmlizer/Htmlizer";

const log = getLog("SchemaForm");
const ajv = new Ajv({ allErrors: false, strictSchema: false, useDefaults: true, allowUnionTypes: true });

/**
 * Renders a form based on a JSON schema. Supports nested objects, arrays of objects, and oneOf using recursion.
 *
 * @param jsonSchema - schema to render (ROOT object schema or schema part of nested object)
 * @param path - path for the nested objects. For ROOT object, path must not be provided.
 * @param onChange - callback for when the value changes. `path` is always calculated for the ROOT object
 * @param obj - object to render (ROOT object or nested object)
 * @param hiddenFields - fields to hide. It is mirror of ROOT object where only fields that needed to be hidden are present.
 * @param showErrors - enables showing validation errors. It is recommended to disable this when for the fresh form of new object until the first save attempt.
 */
export const SchemaForm: React.FC<{
  path?: string[];
  jsonSchema: any;
  hiddenFields?: any;
  showErrors?: boolean;
  onChange: (path: string[], v: any) => void;
  obj: any;
}> = ({ jsonSchema, path, onChange, obj, hiddenFields, showErrors }) => {
  const required = useMemo(() => (jsonSchema.required as string[]) || [], [jsonSchema.required]);
  const properties = useMemo(() => (jsonSchema.properties || {}) as Record<string, any>, [jsonSchema.properties]);

  const validateSingle = useCallback(
    (name: string, fieldSchema: any, value: any) => {
      // ajv validates 'oneOf' without determinant against all possible variants and returns error messages for all of them
      // airbyte schema seems to uses oneOf without determinants. So we better skip validation for such fields
      if (typeof fieldSchema.oneOf === "undefined" && typeof fieldSchema.const === "undefined") {
        const req = required.includes(name);
        const noValue = typeof value === "undefined" || value === null || value === "";
        if (req && noValue) {
          return "Required";
        } else if (!noValue) {
          const validate = ajv.compile(fieldSchema);
          if (!validate(value)) {
            //show only one error message for the field
            return validate.errors?.[0].message;
          }
        }
      }
    },
    [required]
  );

  // Pre init object with default values and constants
  // Rendering will be skipped until all necessary fields will be initialized
  // since changed obj value will trigger consequent rerender anyway
  const skipRender = useMemo(
    () =>
      Object.entries(properties).reduce((acc: boolean, [n, f]) => {
        const value = obj?.[n];
        if (value === undefined && f.default) {
          onChange(path ? [...path, n] : [n], f.default);
          return true;
        } else if (f.const && value !== f.const) {
          onChange(path ? [...path, n] : [n], f.const);
          return true;
        }
        return acc;
      }, false),
    [obj, onChange, path, properties]
  );

  // Validate all object fields
  const errors = useMemo(() => {
    return skipRender
      ? {}
      : Object.entries(properties).reduce((acc: any, [n, f]) => {
          const value = obj?.[n];
          const error = validateSingle(n, f, value);
          if (error) {
            acc = set(acc, path ? [...path, n] : n, error);
          }
          return acc;
        }, {});
  }, [obj, path, properties, skipRender, validateSingle]);

  if (skipRender) {
    return null;
  }

  return (
    <>
      {Object.entries(properties)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([n, f]) => {
          const newPath = path ? [...path, n] : [n];
          const error = get(errors, newPath);
          const isHidden = !(error && showErrors) && get(hiddenFields, newPath);

          const change = (v: any) => {
            onChange(newPath, v);
          };
          let value = obj?.[n];

          const editorProps = { value, onChange: change };

          if (f.const) {
            // if (f.description) {
            //   return (
            //     <div key={n} className={`px-3 py-0.5 text-textLight ${styles.help}`}>
            //       <Htmlizer>{f.description}</Htmlizer>
            //     </div>
            //   );
            // } else {
            return null;
            //}
          }

          return (
            <EditorField
              inner={!!path?.length}
              key={n}
              className={isHidden ? "hidden" : ""}
              id={n}
              errors={showErrors ? error : undefined}
              label={f.title || createDisplayName(n)}
              help={f.description && <Htmlizer>{f.description}</Htmlizer>}
              required={required.includes(n)}
            >
              <>
                {(function () {
                  if (f.type === "object") {
                    if (f.oneOf) {
                      return (
                        <OneOf
                          showErrors={showErrors}
                          name={n}
                          path={newPath}
                          hiddenFields={hiddenFields}
                          fieldSchema={f}
                          onChange={onChange}
                          value={value}
                        />
                      );
                    }
                    return (
                      <SchemaForm
                        hiddenFields={hiddenFields}
                        key={newPath.join(".")}
                        path={newPath}
                        showErrors={showErrors}
                        jsonSchema={f}
                        onChange={onChange}
                        obj={value}
                      />
                    );
                  }
                  switch (f.type) {
                    case "integer":
                    case "number":
                      return <NumberEditor {...editorProps} />;
                    case "string":
                      if (f.format?.includes("date")) {
                        let format = "YYYY-MM-DD";
                        switch (f.pattern) {
                          case "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$":
                            format = "YYYY-MM-DDTHH:mm:ss[Z]";
                            break;
                          case "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}.[0-9]{3}Z$":
                            format = "YYYY-MM-DDTHH:mm:ss.SSS[Z]";
                            break;
                        }
                        return <DateEditor format={format} {...editorProps} />;
                      }
                      if (f.enum) {
                        return (
                          <SelectEditor
                            options={f.enum.map(o => ({
                              value: o,
                              label: o,
                            }))}
                            {...editorProps}
                          />
                        );
                      }
                      if (f.airbyte_secret) {
                        return <PasswordEditor {...editorProps} />;
                      }
                      return <TextEditor rows={f.multiline ? 4 : 1} {...editorProps} />;
                    case "boolean":
                      return <Switch {...editorProps} />;
                    case "array":
                      if (f.items?.type === "object") {
                        return (
                          <ArrayOfObjects
                            name={n}
                            path={newPath}
                            fieldSchema={f}
                            onChange={onChange}
                            value={value}
                            showErrors={showErrors}
                            hiddenFields={hiddenFields}
                          />
                        );
                      } else {
                        const options = f.items?.enum ?? [];
                        return <StringArray options={options} {...editorProps} />;
                      }
                  }
                })()}
              </>
            </EditorField>
          );
        })}
    </>
  );
};
const EditableTabs: React.FC<{ items; onAdd: () => void; onDelete: (k) => void }> = props => {
  const [activeKey, setActiveKey] = useState(props.items?.length > 0 ? props.items[0]?.key : undefined);

  const onChange = (key: string) => {
    setActiveKey(key);
  };

  const onEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: "add" | "remove") => {
    if (action === "add") {
      setActiveKey(props.items.length ?? 1);
      props.onAdd();
    } else {
      if (activeKey >= props.items.length - 1) {
        setActiveKey(props.items.length - 2);
      }
      props.onDelete(targetKey);
    }
  };

  return (
    <Tabs
      tabBarStyle={{ marginBottom: 0 }}
      type="editable-card"
      activeKey={activeKey}
      onChange={onChange}
      addIcon={<PlusIcon />}
      onEdit={onEdit}
      items={props.items}
    />
  );
};

const ArrayOfObjects: React.FC<{
  name: string;
  path: string[];
  fieldSchema: any;
  value?: any;
  hiddenFields?: any;
  showErrors?: boolean;
  onChange: (path: string[], v: any) => void;
}> = ({ fieldSchema, value, hiddenFields, name, path, onChange, showErrors }) => {
  const items = !value
    ? []
    : value.map((v, i) => {
        const arrPath = [...path, i.toString()];
        return {
          label: v?.name || v?.table_name || createDisplayName(name) + ` ${i + 1}`,
          key: i,
          children: (
            <div className={"border-b border-l border-r rounded-b-lg pb-4"}>
              <SchemaForm
                hiddenFields={hiddenFields}
                showErrors={showErrors}
                path={arrPath}
                jsonSchema={fieldSchema.items}
                onChange={onChange}
                obj={v}
              />
            </div>
          ),
        };
      });
  return (
    <EditableTabs
      onAdd={() => {
        onChange([...path, value?.length ?? 0], {});
      }}
      onDelete={k => onChange([...(path ?? []), k.toString()], undefined)}
      items={items}
    />
  );
};

const OneOf: React.FC<{
  name: string;
  path: string[];
  fieldSchema: any;
  value?: any;
  hiddenFields?: any;
  showErrors?: boolean;
  onChange: (path: string[], v: any) => void;
}> = ({ fieldSchema, value, hiddenFields, name, path, onChange, showErrors }) => {
  const options = (fieldSchema.oneOf as any[]).map((o, i) => ({
    label: o.title,
    value: i,
  }));
  // find discriminator field. This is a field that is present in all oneOf variants and has a const or enum with a single value
  // discriminator is used to determine which variant is selected
  const consts = (fieldSchema.oneOf as any[])
    .map(o => o.properties)
    .map(p => Object.entries(p as Record<string, any>))
    .flat()
    .reduce((acc: any, [k, v]) => {
      if (v.const || v.enum?.length === 1) {
        acc[k] = (acc[k] ?? 0) + 1;
      }
      return acc;
    }, {});
  const discriminator = Object.entries(consts).find(([k, v]) => v === fieldSchema.oneOf?.length);

  if (!discriminator) {
    log.atError().log("No discriminator found for oneOf field", name);
    return <></>;
  }
  const discriminatorKey = discriminator[0];
  const discriminatorValue = value?.[discriminatorKey];

  let selected: any;
  let selectedIdx: number = 0;
  let removeIdx = -1;
  for (let i = 0; i < fieldSchema.oneOf.length; i++) {
    const o = fieldSchema.oneOf[i];
    if (
      o.properties[discriminatorKey].const === discriminatorValue ||
      o.properties[discriminatorKey].enum?.[0] === discriminatorValue
    ) {
      selected = o;
      selectedIdx = i;
      break;
    }
  }
  //Hide CDC option for replication_method
  if (name === "replication_method") {
    for (let i = 0; i < fieldSchema.oneOf.length; i++) {
      const o = fieldSchema.oneOf[i];
      if (o.properties[discriminatorKey].const === "CDC" || o.properties[discriminatorKey].enum?.[0] === "CDC") {
        removeIdx = i;
        break;
      }
    }
  }

  const filteredOptions = options.filter((o, i) => i !== removeIdx);

  return (
    <>
      <SelectEditor
        value={selected ? selectedIdx : undefined}
        onChange={v => {
          onChange(path, {
            [discriminatorKey]:
              fieldSchema.oneOf[v].properties[discriminatorKey].const ||
              fieldSchema.oneOf[v].properties[discriminatorKey].enum?.[0],
          });
        }}
        options={filteredOptions}
      />
      {selected && (
        <SchemaForm
          hiddenFields={hiddenFields}
          key={selectedIdx + "." + path.join(".")}
          showErrors={showErrors}
          path={path}
          jsonSchema={selected}
          onChange={onChange}
          obj={value}
        />
      )}
    </>
  );
};
