import React, { createContext, PropsWithChildren, ReactNode, useContext, useEffect, useState } from "react";
import { Button, Col, Form as AntdForm, Input, Row, Skeleton, Switch, Table } from "antd";
import { FaCaretDown, FaCaretRight, FaClone, FaPlus } from "react-icons/fa";
import { ZodType } from "zod";
import { getConfigApi, useApi } from "../../lib/useApi";
import { useRouter } from "next/router";
import { asFunction, FunctionLike, getErrorMessage, getLog, requireDefined, rpc } from "juava";

import zodToJsonSchema from "zod-to-json-schema";

import styles from "./ConfigEditor.module.css";

import validator from "@rjsf/validator-ajv6";
import { Form } from "@rjsf/antd";

import {
  ADDITIONAL_PROPERTY_FLAG,
  canExpand,
  FormContextType,
  IconButtonProps,
  ObjectFieldTemplatePropertyType,
  ObjectFieldTemplateProps,
  RJSFSchema,
  StrictRJSFSchema,
  UI_OPTIONS_KEY,
  UiSchema,
} from "@rjsf/utils";

import { ConfigEntityBase } from "../../lib/schema";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { GlobalLoader, LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { WLink } from "../Workspace/WLink";
import { DeleteOutlined } from "@ant-design/icons";
import { ErrorCard, GlobalError } from "../GlobalError/GlobalError";
import { Action, confirmOp, doAction, feedbackError, feedbackSuccess, useTitle } from "../../lib/ui";
import { branding } from "../../lib/branding";
import { useAntdModal } from "../../lib/modal";
import { Edit3, Inbox } from "lucide-react";
import { createDisplayName, prepareZodObjectForSerialization } from "../../lib/zod";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { EditorTitle } from "./EditorTitle";
import { EditorBase } from "./EditorBase";
import { EditorField } from "./EditorField";
import { EditorButtons } from "./EditorButtons";
import { ButtonGroup, ButtonProps } from "../ButtonGroup/ButtonGroup";
import cuid from "cuid";
import { ObjectTitle } from "../ObjectTitle/ObjectTitle";
import omitBy from "lodash/omitBy";

const log = getLog("ConfigEditor");

export type FieldDisplay = {
  isId?: boolean;
  hidden?: boolean;
  displayName?: string;
  editor?: any;
  advanced?: boolean;
  documentation?: ReactNode;
  constant?: any;
  textarea?: boolean;
  password?: boolean;
};

export type EditorComponentFactory = (props: EditorComponentProps) => React.FC<EditorComponentProps> | undefined;

export type ConfigEditorProps<T extends { id: string } = { id: string }, M = {}> = {
  listTitle?: ReactNode;
  type: string;
  listColumns?: { title: ReactNode; render: (o: T) => ReactNode }[];
  icon?: (o: T) => ReactNode;
  name?: (o: T) => string;
  objectType: FunctionLike<ZodType<T>, T>;
  fields: Record<string, FieldDisplay>;
  explanation: ReactNode;
  noun: string;
  nounPlural?: string;
  addAction?: Action;
  editorTitle?: (o: T, isNew: boolean, meta?: M) => ReactNode;
  subtitle?: (o: T, isNew: boolean, meta?: M) => ReactNode;
  createKeyword?: string;
  //allows to hide certain objects in the list view
  filter?: (o: T) => boolean;
  actions?: {
    title: ReactNode;
    icon?: ReactNode;
    hideLabel?: boolean;
    collapsed?: boolean;
    key?: string;
    action?: (o: T) => void;
    link?: (o: T) => string;
    disabled?: (o: T) => string | boolean;
  }[];
  loadMeta?: (o: T | undefined) => Promise<M>;
  newObject?: (meta?: M) => Partial<T>;
  //for providing custom editor component
  editorComponent?: EditorComponentFactory;
  testConnectionEnabled?: (o: any) => boolean;
  onTest?: (o: T) => Promise<ConfigTestResult>;
  backTo?: string;
};

type JsonSchema = any;

function getUiWidget(field: FieldDisplay) {
  if (field?.constant || field?.hidden) {
    return "hidden";
  } else if (field?.editor) {
    return field?.editor;
  } else if (field?.textarea) {
    return "textarea";
  } else if (field?.password) {
    return "password";
  } else {
    return undefined;
  }
}

function getUiSchema(schema: JsonSchema, fields: Record<string, FieldDisplay>): UiSchema {
  return {
    ...Object.entries((schema as any).properties)
      .map(([name]) => {
        const field = fields[name];
        const fieldProps = {
          "ui:widget": getUiWidget(field),
          "ui:disabled": field?.constant ? true : undefined,
          "ui:placeholder": field?.constant,
          "ui:title": field?.displayName || createDisplayName(name),
          "ui:FieldTemplate": FieldTemplate,
          "ui:ObjectFieldTemplate": NestedObjectTemplate,
          "ui:help": field?.documentation || undefined,
          additionalProperties: {
            "ui:FieldTemplate": NestedObjectFieldTemplate,
          },
        };
        return {
          [name]: omitBy(fieldProps, v => v === undefined),
        };
      })
      .reduce((a, b) => ({ ...a, ...b }), {}),
    id: { "ui:widget": "hidden" },
    "ui:submitButtonOptions": {
      norender: true,
    },
  };
}

export type SingleObjectEditorProps = ConfigEditorProps & {
  object?: ConfigEntityBase & Record<string, any>;
  createNew?: boolean;
};

export const AdvancedConfiguration: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`w-full h-full mb-6`}>
      <div
        className={`text-lg flex items-center cursor-pointer ${!expanded && "border-b border-backgroundDark pb-3"}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{expanded ? <FaCaretDown className="w-4 h-4" /> : <FaCaretRight className="w-4 h-4" />}</span>
        <div className="ml-2">Advanced Configuration Options</div>
      </div>
      {expanded && <div className="py-4">{children}</div>}
    </div>
  );
};

const FormList: React.FC<ObjectFieldTemplateProps> = props => {
  const formConfig: ConfigEditorProps = props.formContext;
  const advancedFields = props.properties.filter(element => !!formConfig.fields[element.name]?.advanced);
  const fields = props.properties.filter(element => !formConfig.fields[element.name]?.advanced);

  return (
    <div>
      {fields.map(element => (
        <div key={element.name} className={`${element.hidden && "hidden"}`}>
          {element.content}
        </div>
      ))}
      {advancedFields.length > 0 && (
        <AdvancedConfiguration>
          {advancedFields.map(element => (
            <div key={element.name} className={`${element.hidden && "hidden"}`}>
              {element.content}
            </div>
          ))}
        </AdvancedConfiguration>
      )}
    </div>
  );
};

const CustomCheckbox = function (props) {
  return <Switch checked={props.value} onClick={() => props.onChange(!props.value)} />;
};

export type ConfigTestResult = { ok: true } | { ok: false; error: string };

export type ConfigEditorActions = {
  onSave: (o: any) => Promise<void>;
  onTest?: (o: any) => Promise<ConfigTestResult>;
  onCancel: (confirm: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
};

export type EditorComponentProps = SingleObjectEditorProps &
  ConfigEditorActions & {
    isNew: boolean;
    meta: any;
    testConnectionEnabled: (o: any) => boolean;
    object: ConfigEntityBase & Record<string, any>;
  };

function AddButton(props: IconButtonProps) {
  const { icon, iconType, ...btnProps } = props;
  return (
    <Button
      type={"primary"}
      ghost={true}
      onClick={e => {
        btnProps.onClick && btnProps.onClick(e);
      }}
    >
      Add parameter
    </Button>
  );
}

const EditorComponent: React.FC<EditorComponentProps> = props => {
  const {
    noun,
    createNew,
    objectType,
    meta,
    fields,
    onCancel,
    onSave,
    onDelete,
    testConnectionEnabled,
    onTest,
    object,
    isNew,
    subtitle,
  } = props;
  useTitle(`${branding.productName} : ${createNew ? `Create new ${noun}` : `Edit ${noun}`}`);
  const [loading, setLoading] = useState<boolean>(false);
  const objectTypeFactory = asFunction<ZodType, any>(objectType);
  const schema = zodToJsonSchema(objectTypeFactory(object));
  const [formState, setFormState] = useState<any | undefined>(undefined);
  const hasErrors = formState?.errors?.length > 0;
  const isTouched = formState !== undefined || !!createNew;
  const uiSchema = getUiSchema(schema, fields);

  const [submitCount, setSubmitCount] = useState(0);
  const modal = useAntdModal();
  const onFormChange = state => {
    setFormState(state);
    log.atDebug().log(`Updating editor form state`, state);
  };
  const withLoading = (fn: () => Promise<void>) => async () => {
    setLoading(true);
    try {
      await fn();
    } finally {
      setLoading(false);
    }
  };

  const title = props.editorTitle
    ? props.editorTitle(object, isNew, meta)
    : isNew
    ? `Create new ${noun}`
    : `Edit ${noun}`;
  const subtitleComponent = subtitle && subtitle(object, isNew, meta);
  return (
    <EditorBase onCancel={onCancel} isTouched={isTouched}>
      <EditorTitle title={title} subtitle={subtitleComponent} onBack={withLoading(() => onCancel(isTouched))} />
      <EditorComponentContext.Provider value={{ displayInlineErrors: !isNew || submitCount > 0 }}>
        <Form
          formContext={props}
          templates={{ ObjectFieldTemplate: FormList, ButtonTemplates: { AddButton } }}
          widgets={{ CheckboxWidget: CustomCheckbox }}
          omitExtraData={true}
          liveOmit={true}
          showErrorList={false}
          onChange={onFormChange}
          className={styles.editForm}
          schema={schema as any}
          liveValidate={true}
          validator={validator}
          onSubmit={async ({ formData }) => {
            if (onTest && testConnectionEnabled && testConnectionEnabled(formData || object)) {
              const testRes = await onTest(formState?.formData || object);
              if (!testRes.ok) {
                modal.confirm({
                  title: "Connection test failed",
                  content: testRes.error,
                  okText: "Save anyway",
                  okType: "danger",
                  cancelText: "Cancel",
                  onOk: () => {
                    withLoading(() => onSave({ ...formData, testConnectionError: testRes.error }))();
                  },
                });
                return;
              } else {
                delete formData.testConnectionError;
              }
            }
            withLoading(() => onSave(formData))();
          }}
          formData={formState?.formData || object}
          uiSchema={uiSchema}
        >
          <EditorButtons
            loading={loading}
            isNew={isNew}
            isTouched={isTouched}
            hasErrors={hasErrors}
            onTest={
              onTest && testConnectionEnabled && testConnectionEnabled(formState?.formData || object)
                ? () => onTest(formState?.formData || object)
                : undefined
            }
            onDelete={withLoading(onDelete)}
            onCancel={withLoading(() => onCancel(isTouched))}
            onSave={() => {
              setSubmitCount(submitCount + 1);
              if (hasErrors) {
                modal.error({
                  title: "There are errors in the configuration",
                  content: (
                    <>
                      Please fix following errors. Fields with errors are marked with red{" "}
                      <ul className="block mt-2 ml-5">
                        {formState.errors.map((e: any) => {
                          const fieldId = e.property.replace(".", "");
                          return (
                            <li className="list-disc" key={e.message}>
                              <strong>{fieldId}</strong> {e.message}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ),
                });
              }
            }}
          />
        </Form>
      </EditorComponentContext.Provider>
    </EditorBase>
  );
};

const SingleObjectEditor: React.FC<SingleObjectEditorProps> = props => {
  const {
    noun,
    createNew,
    objectType,
    nounPlural = `${noun}s`,
    type,
    fields,
    newObject = () => ({}),
    loadMeta,
    onTest,
    backTo,
    ...otherProps
  } = props;
  const [meta, setMeta] = useState<any>(undefined);
  const isNew = !!(!otherProps.object || createNew);
  const workspace = useWorkspace();
  const appConfig = useAppConfig();
  const router = useRouter();

  useEffect(() => {
    if (loadMeta) {
      loadMeta(otherProps.object).then(setMeta);
    } else {
      setMeta({});
    }
  }, [loadMeta, otherProps.object]);

  if (meta === undefined) {
    return <LoadingAnimation />;
  }
  const object = otherProps.object || {
    id: cuid(),
    workspaceId: workspace.id,
    type: type,
    ...newObject(meta),
  };

  const onCancel = async (confirm: boolean) => {
    if (!confirm || (await confirmOp("Are you sure you want to close this page? All unsaved changes will be lost."))) {
      if (backTo) {
        router.push(`/${workspace.id}${backTo}`);
      } else {
        router.push(`/${workspace.id}/${type}s`);
      }
    }
  };
  const onDelete = async () => {
    if (await confirmOp(`Are you sure you want to delete this ${noun}?`)) {
      try {
        await getConfigApi(workspace.id, type).del(object.id);
        feedbackSuccess(`Successfully deleted ${noun}`);
        router.push(`/${workspace.id}/${type}s`);
      } catch (error) {
        feedbackError("Failed to delete object", { error });
      }
    }
  };
  const onSave = async newObject => {
    newObject = prepareZodObjectForSerialization(newObject);
    console.log("Saving", newObject);
    try {
      if (isNew) {
        await getConfigApi(workspace.id, type).create(newObject);
        if (type === "stream" && appConfig.ee.available) {
          try {
            await rpc(`/api/${workspace.id}/ee/s3-init`, {
              method: "POST",
              query: { workspaceId: workspace.id },
            });
          } catch (e: any) {
            console.error("Failed to init S3 bucket", e.message);
          }
        }
      } else {
        await getConfigApi(workspace.id, type).update(object.id, newObject);
        //await new Promise(resolve => setTimeout(resolve, 10000000));
      }
      if (backTo) {
        router.push(`/${workspace.id}${backTo}`);
      } else {
        router.push(`/${workspace.id}/${type}s`);
      }
    } catch (error) {
      feedbackError("Failed to save object", { error });
    }
  };
  const editorComponentProps = {
    ...props,
    meta,
    onCancel,
    onSave,
    onDelete,
    object,
    isNew,
    noun,
  } as EditorComponentProps;

  if (!props.editorComponent) {
    return <EditorComponent {...editorComponentProps} />;
  } else {
    const CustomEditorComponent = props.editorComponent(editorComponentProps);
    if (CustomEditorComponent) {
      return <CustomEditorComponent {...editorComponentProps} />;
    } else {
      return <EditorComponent {...editorComponentProps} />;
    }
  }
};

type EditorComponentContextProps = {
  displayInlineErrors: boolean;
};

const EditorComponentContext = createContext<EditorComponentContextProps>(undefined!);

const NestedObjectTemplate = function <
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any
>(props: ObjectFieldTemplateProps<T, S, F>) {
  const { disabled, formData, idSchema, onAddClick, properties, readonly, registry, schema, uiSchema } = props;

  // Button templates are not overridden in the uiSchema
  const {
    ButtonTemplates: { AddButton },
  } = registry.templates;

  return (
    <fieldset id={idSchema.$id} className={styles.nestedObjectField}>
      <Row gutter={24}>
        {properties
          .filter(e => !e.hidden)
          .map((element: ObjectFieldTemplatePropertyType) => (
            <Col key={element.name} span={24}>
              {element.content}
            </Col>
          ))}
      </Row>

      {canExpand(schema, uiSchema, formData) && (
        <Col span={24}>
          <Row gutter={12} justify="start">
            <Col span={2}>
              <AddButton
                className="object-property-expand"
                disabled={disabled || readonly}
                onClick={onAddClick(schema)}
                uiSchema={uiSchema}
                registry={registry}
              />
            </Col>
          </Row>
        </Col>
      )}
    </fieldset>
  );
};

const NestedObjectFieldTemplate = props => {
  const formCtx = requireDefined(useContext(EditorComponentContext), "Not in <EditorComponentContext.Provider />");
  const {
    id,
    classNames,
    label,
    help,
    required,
    errors,
    children,
    schema,
    uiSchema,
    disabled,
    readonly,
    registry,
    onKeyChange,
    onDropPropertyClick,
  } = props;
  const { readonlyAsDisabled = true } = registry.formContext;
  const { RemoveButton } = registry.templates.ButtonTemplates;
  const hasErrors = !!errors?.props?.errors && formCtx.displayInlineErrors;
  const helpProp = !!help?.props?.help ? help : undefined;
  const errorsProp = !!errors?.props?.errors && formCtx.displayInlineErrors ? errors : undefined;
  const additional = ADDITIONAL_PROPERTY_FLAG in schema;
  const handleBlur = ({ target }: React.FocusEvent<HTMLInputElement>) => onKeyChange(target.value);

  // The `block` prop is not part of the `IconButtonProps` defined in the template, so put it into the uiSchema instead
  const uiOptions = uiSchema ? uiSchema[UI_OPTIONS_KEY] : {};
  const buttonUiOptions = {
    ...uiSchema,
    [UI_OPTIONS_KEY]: { ...uiOptions, block: true },
  };

  return !additional ? (
    <EditorField id={id} className={classNames} required={required} label={label} help={helpProp} errors={errorsProp}>
      {children}
    </EditorField>
  ) : (
    <Row gutter={12}>
      <Col span={8}>
        <AntdForm.Item className="form-group" hasFeedback htmlFor={`${id}-key`} required={required}>
          <Input
            className="form-control"
            defaultValue={label}
            disabled={disabled || (readonlyAsDisabled && readonly)}
            id={`${id}-key`}
            name={`${id}-key`}
            onBlur={!readonly ? handleBlur : undefined}
            type="text"
          />
        </AntdForm.Item>
      </Col>
      <Col span={14}>
        <div className={`${hasErrors && styles.invalidInput}`}>{children}</div>
      </Col>
      <Col span={2}>
        <RemoveButton
          className="array-item-remove"
          disabled={disabled || readonly}
          onClick={onDropPropertyClick(label)}
          uiSchema={buttonUiOptions}
          registry={registry}
        />
      </Col>
    </Row>
  );
};

const FieldTemplate = props => {
  const formCtx = requireDefined(useContext(EditorComponentContext), "Not in <EditorComponentContext.Provider />");
  const { id, classNames, label, help, required, errors, children } = props;
  const helpProp = !!help?.props?.help ? help : undefined;
  const errorsProp = !!errors?.props?.errors && formCtx.displayInlineErrors ? errors : undefined;
  return (
    <EditorField id={id} className={classNames} required={required} label={label} help={helpProp} errors={errorsProp}>
      {children}
    </EditorField>
  );
};

const SingleObjectEditorLoader: React.FC<ConfigEditorProps & { id: string; clone?: boolean }> = ({
  id,
  clone,
  ...rest
}) => {
  const workspace = useWorkspace();
  const { isLoading, data, error } = useApi(`/api/${workspace.id}/config/${rest.type}/${id}`);
  if (isLoading) {
    return <GlobalLoader />;
  } else if (error) {
    return <GlobalError error={error} />;
  }
  return (
    <SingleObjectEditor
      {...rest}
      createNew={!!clone}
      object={
        clone
          ? {
              ...data,
              id: cuid(),
              name: `${data.name} (copy)`,
            }
          : data
      }
    />
  );
};

const ConfigEditor: React.FC<ConfigEditorProps> = props => {
  const router = useRouter();
  const id = router.query.id as string;
  const clone = router.query.clone as string;
  const backTo = router.query.backTo as string;
  if (id) {
    if (id === "new") {
      if (clone) {
        return <SingleObjectEditorLoader {...props} id={clone} backTo={backTo} clone={true} />;
      } else {
        return <SingleObjectEditor {...props} backTo={backTo} />;
      }
    } else {
      return <SingleObjectEditorLoader {...props} id={id} backTo={backTo} />;
    }
  } else {
    return <ObjectListEditor {...props} />;
  }
};

function plural(noun: string) {
  return noun + "s";
}

const ObjectsList: React.FC<{ objects: any[]; onDelete: (id: string) => Promise<void> } & ConfigEditorProps> = ({
  objects,
  type,
  onDelete,
  listColumns = [],
  actions = [],
  noun,
  icon,
  name = (o: any) => o.name,
}) => {
  const modal = useAntdModal();
  useTitle(`${branding.productName} : ${plural(noun)}`);
  const deleteObject = id => {
    modal.confirm({
      title: `Are you sure you want to delete ${noun}?`,
      onOk: async () => {
        await onDelete(id);
      },
    });
  };

  const columns = [
    {
      title: "Name",
      render: (text, record) => (
        <WLink href={`/${type}s?id=${record.id}`}>
          <ObjectTitle title={name(record)} icon={icon ? icon(record) : undefined} />
        </WLink>
      ),
    },
    ...listColumns.map(c => ({
      title: c.title,
      render: (text, record) => c.render(record),
    })),
    {
      title: "",
      className: "text-right",
      render: (text, record) => {
        const items: ButtonProps[] = [
          {
            label: "Edit",
            href: `/${type}s?id=${record.id}`,
            icon: <Edit3 className={"w-4 h-4"} />,
          },
          ...actions.map(action => ({
            disabled: !!(action.disabled && action.disabled(record)),
            href: action.link ? action.link(record) : undefined,
            label: action.title,
            hideLabel: action.hideLabel,
            collapsed: action.collapsed,
            onClick: action.action
              ? () => {
                  (action.action as any)(record);
                }
              : undefined,
            icon: <div className="w-4 h-4">{action.icon}</div>,
          })),
          {
            label: "Clone",
            href: `/${type}s?id=new&clone=${record.id}`,
            icon: <FaClone />,
          },
          {
            label: "Delete",
            danger: true,
            onClick: () => deleteObject(record.id),
            icon: <DeleteOutlined />,
          },
        ].filter(i => !!i);
        return <ButtonGroup collapseLast={2} items={items} />;
      },
    },
  ];
  return (
    <div>
      <Table
        rowKey="id"
        className={styles.listTable}
        dataSource={objects}
        columns={columns}
        showHeader={listColumns.length > 0}
        pagination={false}
      />
    </div>
  );
};

const ObjectListEditor: React.FC<ConfigEditorProps> = props => {
  const workspace = useWorkspace();
  const { isLoading, data, error, reload } = useApi(`/api/${workspace.id}/config/${props.type}`);
  const router = useRouter();
  const pluralNoun = props.nounPlural || plural(props.noun);
  const addAction = props.addAction || (() => router.push(`${router.asPath}?id=new`));
  const onDelete = async (id: string) => {
    try {
      await getConfigApi(workspace.id, props.type).del(id);
      reload();
    } catch (e) {
      alert(`Failed to delete ${props.noun}: ${getErrorMessage(e)}`);
    }
  };
  const list = data?.objects?.filter(props.filter || (() => true)) || [];
  return (
    <div>
      <div className="flex justify-between py-6">
        <div className="flex items-center">
          <div className="text-3xl">{props.listTitle || `Edit ${pluralNoun}`}</div>
        </div>
        <div>
          <JitsuButton
            onClick={() => doAction(router, addAction)}
            type="primary"
            size="large"
            disabled={!!(isLoading || error)}
            icon={<FaPlus />}
          >
            Add new {props.noun}
          </JitsuButton>
        </div>
      </div>
      <div>
        {isLoading && <Skeleton active title={false} paragraph={{ rows: 8, width: "100%" }} />}
        {error && <ErrorCard error={error} title={`Failed to load the list of ${pluralNoun}`} />}
        {list.length === 0 && !isLoading && !error && (
          <div>
            <div className="flex flex-col items-center">
              <Inbox className="h-16 w-16 my-6 text-neutral-200" />
              <div className="text text-textLight mb-6">You don't any have {props.noun}s configured.</div>

              <Button type="default" onClick={() => doAction(router, addAction)}>
                {props.createKeyword || "Create"} your first {props.noun}
              </Button>
            </div>
          </div>
        )}
        {list.length > 0 && <ObjectsList {...props} objects={list} onDelete={onDelete} />}
      </div>
    </div>
  );
};
export { ConfigEditor };
