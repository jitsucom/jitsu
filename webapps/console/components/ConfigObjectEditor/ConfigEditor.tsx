import React, { createContext, PropsWithChildren, ReactNode, useContext, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Dropdown,
  Form as AntdForm,
  Input,
  MenuProps,
  Popover,
  Row,
  Skeleton,
  Switch,
  Table,
} from "antd";
import { FaCaretDown, FaCaretRight, FaClone, FaExclamationCircle, FaPlus } from "react-icons/fa";
import { ZodType } from "zod";
import { getConfigApi, useApi } from "../../lib/useApi";
import { useRouter } from "next/router";
import { asFunction, FunctionLike, getErrorMessage, getLog, randomId, requireDefined } from "juava";

import zodToJsonSchema from "zod-to-json-schema";

import styles from "./ConfigEditor.module.css";

import validator from "@rjsf/validator-ajv6";
import { Form } from "@rjsf/antd/dist/antd.cjs.development";
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
import { useWorkspace } from "../../lib/context";
import omitBy from "lodash/omitBy";
import { GlobalLoader } from "../GlobalLoader/GlobalLoader";
import { WLink } from "../Workspace/WLink";
import { CheckOutlined, DeleteOutlined, EditOutlined, LoadingOutlined } from "@ant-design/icons";
import { ErrorCard, GlobalError } from "../GlobalError/GlobalError";
import { Action, confirmOp, doAction, feedbackError, feedbackSuccess, useKeyboard, useTitle } from "../../lib/ui";
import { branding } from "../../lib/branding";
import { useAntdModal } from "../../lib/modal";
import { getCoreDestinationType } from "../../lib/schema/destinations";
import { ChevronLeft, Inbox } from "lucide-react";
import { createDisplayName, prepareZodObjectForSerialization } from "../../lib/zod";
import { JitsuButton } from "../JitsuButton/JitsuButton";

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

export type EditorComponentFactory = (props: EditorComponentProps) => ReactNode | undefined;

export type ConfigEditorProps<T extends { id: string } = { id: string }> = {
  listTitle?: ReactNode;
  type: string;
  listColumns?: { title: ReactNode; render: (o: T) => ReactNode }[];
  name?: (o: T) => string;
  objectType: FunctionLike<ZodType<T>, T>;
  fields: Record<string, FieldDisplay>;
  explanation: ReactNode;
  noun: string;
  nounPlural?: string;
  addAction?: Action;
  editorTitle?: (o: T, isNew: boolean) => ReactNode;
  subtitle?: (o: T, isNew: boolean) => ReactNode;
  createKeyword?: string;
  //allows to hide certain objects in the list view
  filter?: (o: T) => boolean;
  actions?: {
    title: ReactNode;
    icon?: ReactNode;
    key?: string;
    action?: (o: T) => void;
    link?: (o: T) => string;
    disabled?: (o: T) => string | boolean;
  }[];
  newObject?: () => Partial<T>;
  //for providing custom editor component
  editorComponent?: EditorComponentFactory;
};

export type CustomWidgetProps<T> = {
  value: T | undefined;
  onChange: (value: T) => void;
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

type ConfigTestResult = { ok: true } | { ok: false; error: string };

export type ConfigEditorActions = {
  onSave: (o: any) => Promise<void>;
  onTest?: (o: any) => Promise<ConfigTestResult>;
  onCancel: (confirm: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
};

export type EditorComponentProps = SingleObjectEditorProps &
  ConfigEditorActions & {
    isNew: boolean;
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
  const { noun, createNew, objectType, fields, onCancel, onSave, onDelete, onTest, object, isNew, subtitle } = props;
  useTitle(`${branding.productName} : ${createNew ? `Create new ${noun}` : `Edit ${noun}`}`);
  const [loading, setLoading] = useState<boolean>(false);
  const [testStatus, setTestStatus] = useState<string>("");
  const buttonDivRef = useRef<HTMLDivElement>(null);
  const objectTypeFactory = asFunction<ZodType, any>(objectType);
  const schema = zodToJsonSchema(objectTypeFactory(object));
  const [formState, setFormState] = useState<any | undefined>(undefined);
  const hasErrors = formState?.errors?.length > 0;
  const isTouched = formState !== undefined || !!createNew;
  const uiSchema = getUiSchema(schema, fields);
  log.atDebug().log("Rendring <EditorComponent /> with schema and props", schema, props);

  const [submitCount, setSubmitCount] = useState(0);
  const modal = useAntdModal();
  const onFormChange = state => {
    setTestStatus("");
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
  useKeyboard("Escape", () => {
    onCancel(isTouched);
  });

  const doTest = async (obj: any) => {
    if (onTest) {
      setTestStatus("pending");
      try {
        const testRes = await onTest(obj);
        log.atDebug().log("Test result", testRes);
        if (testRes.ok) {
          setTestStatus("success");
        } else {
          setTestStatus(testRes?.error || "unknown error");
        }
      } catch (e) {
        setTestStatus("failed to test connection: " + e);
      } finally {
        setTimeout(() => {
          buttonDivRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 50);
      }
    }
  };

  useEffect(() => {
    const handler = async event => {
      if (isTouched) {
        event.preventDefault();
        return (event.returnValue = "Are you sure you want to exit? You have unsaved changes");
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isTouched]);

  const title = props.editorTitle ? props.editorTitle(object, isNew) : isNew ? `Create new ${noun}` : `Edit ${noun}`;
  const subtitleComponent = subtitle && subtitle(object, isNew);
  return (
    <div className="flex justify-center">
      <div key={"header"} className="max-w-4xl grow">
        <div className="flex justify-between pt-6 pb-0 mb-0 items-center ">
          <h1 className="text-3xl">{title}</h1>
          <div>
            <JitsuButton
              icon={<ChevronLeft className="w-6 h-6" />}
              type="link"
              size="small"
              onClick={withLoading(() => onCancel(isTouched))}
            >
              Back
            </JitsuButton>
          </div>
        </div>
        {subtitleComponent && <div>{subtitleComponent}</div>}
        <div key={"form"} className="pt-6">
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
              onSubmit={({ formData }) => withLoading(() => onSave(formData))()}
              formData={formState?.formData || object}
              uiSchema={uiSchema}
            >
              {testStatus && testStatus !== "success" && testStatus !== "pending" && (
                <Alert message="Connection test failed" description={testStatus} type="error" showIcon closable />
              )}
              <div className="flex justify-between mt-4">
                <div>
                  {!isNew && (
                    <Button disabled={loading} type="primary" ghost danger size="large" onClick={withLoading(onDelete)}>
                      Delete
                    </Button>
                  )}
                </div>
                <div className="flex justify-end space-x-5" ref={buttonDivRef}>
                  {onTest &&
                    (testStatus === "success" ? (
                      <Popover content={"Connection test passed"} color={"lime"} trigger={"hover"}>
                        <Button
                          type="link"
                          disabled={loading}
                          size="large"
                          onClick={() => {
                            doTest(formState?.formData || object);
                          }}
                        >
                          <CheckOutlined /> Test Connection
                        </Button>
                      </Popover>
                    ) : (
                      <Button
                        type="link"
                        disabled={loading}
                        size="large"
                        onClick={() => {
                          log.atDebug().log(`Testing connection with`, formState?.formData || object);
                          doTest(formState?.formData || object);
                        }}
                      >
                        {testStatus === "pending" ? (
                          <>
                            <LoadingOutlined /> Test Connection
                          </>
                        ) : (
                          "Test Connection"
                        )}
                      </Button>
                    ))}
                  <Button
                    type="primary"
                    ghost
                    size="large"
                    onClick={withLoading(() => onCancel(isTouched))}
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="primary"
                    size="large"
                    loading={loading}
                    disabled={!isTouched}
                    htmlType={isTouched && !hasErrors ? "submit" : "button"}
                    onClick={() => {
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
                  >
                    Save
                  </Button>
                </div>
              </div>
            </Form>
          </EditorComponentContext.Provider>
        </div>
      </div>
    </div>
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
    ...otherProps
  } = props;
  const isNew = !!(!otherProps.object || createNew);
  const workspace = useWorkspace();
  const object = otherProps.object || {
    id: randomId(),
    workspaceId: workspace.id,
    type: type,
    ...newObject(),
  };

  const router = useRouter();

  const onCancel = async (confirm: boolean) => {
    if (!confirm) {
      await router.push(`/${workspace.id}/${type}s`);
    } else {
      if (await confirmOp("Are you sure you want to close this page? All unsaved changes will be lost.")) {
        await router.push(`/${workspace.id}/${type}s`);
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
      } else {
        await getConfigApi(workspace.id, type).update(object.id, newObject);
        //await new Promise(resolve => setTimeout(resolve, 10000000));
      }
      router.push(`/${workspace.id}/${type}s`);
    } catch (error) {
      feedbackError("Failed to save object", { error });
    }
  };
  const editorComponentProps = {
    ...props,
    onCancel,
    onSave,
    onDelete,
    object,
    isNew,
    noun,
  } as EditorComponentProps;

  if (type === "destination") {
    const destinationType = requireDefined(
      getCoreDestinationType(object.destinationType),
      `Unknown destination type ${object.destinationType}`
    );
    if (destinationType.usesBulker) {
      editorComponentProps.onTest = async obj => {
        try {
          const res = await getConfigApi(workspace.id, type).test(obj);
          return res.ok ? { ok: true } : { ok: false, error: res?.error || res?.message || "uknown error" };
        } catch (error) {
          log
            .atWarn()
            .log(
              `Failed to test destination ${workspace.id} / ${type}. This is not expected since destination tester should return 200 even in credentials are wrong`,
              error
            );
          return { ok: false, error: "Internal error, see logs for details" };
          //feedbackError("Failed to test object", { error });
        }
      };
    }
  }
  if (!props.editorComponent) {
    return <EditorComponent {...editorComponentProps} />;
  } else {
    const editorComponent = props.editorComponent(editorComponentProps);
    return <>{editorComponent || <EditorComponent {...editorComponentProps} />}</>;
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
  const hasHelp = !!help?.props?.help;
  const hasErrors = !!errors?.props?.errors && formCtx.displayInlineErrors;
  const additional = ADDITIONAL_PROPERTY_FLAG in schema;
  const handleBlur = ({ target }: React.FocusEvent<HTMLInputElement>) => onKeyChange(target.value);

  // The `block` prop is not part of the `IconButtonProps` defined in the template, so put it into the uiSchema instead
  const uiOptions = uiSchema ? uiSchema[UI_OPTIONS_KEY] : {};
  const buttonUiOptions = {
    ...uiSchema,
    [UI_OPTIONS_KEY]: { ...uiOptions, block: true },
  };

  return !additional ? (
    <div className={`${classNames}`}>
      <div className={`${!hasHelp && "pb-3"}`}>
        <div className="flex items-center justify-between">
          <label className="flex items-center" htmlFor={id}>
            {label}
            {required && <span className={styles.required}>(required)</span>}:
          </label>
          <div>
            <div
              className={`text-error px-2 py-1 mt-1   flex items-center space-x-1 ${
                hasErrors ? "visible" : "invisible"
              }`}
            >
              <div>
                <FaExclamationCircle />
              </div>
              <div className="font-bold">{label}</div>
              {errors}
            </div>
          </div>
        </div>
        <div className={`${hasErrors && styles.invalidInput}`}>{children}</div>
      </div>
      {hasHelp && (
        <div className={`border-t text-textDisabled border-backgroundDark bg-background ${styles.help}`}>
          <div className="">{help}</div>
        </div>
      )}
    </div>
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
  const hasHelp = !!help?.props?.help;
  const hasErrors = !!errors?.props?.errors && formCtx.displayInlineErrors;
  return (
    <div className={`${classNames} border rounded-lg border-backgroundDark mb-4`}>
      <div className={`px-6 py-4 ${!hasHelp && "pb-8"}`}>
        <div className="flex items-center mb-4 justify-between">
          <label className="text-xl flex items-center" htmlFor={id}>
            {label}
            {required && <span className={styles.required}>(required)</span>}
          </label>
          <div>
            <div
              className={`text-error px-2 py-1 mt-1   flex items-center space-x-1 ${
                hasErrors ? "visible" : "invisible"
              }`}
            >
              <div>
                <FaExclamationCircle />
              </div>
              <div className="font-bold">{label}</div>
              {errors}
            </div>
          </div>
        </div>
        <div className={`${hasErrors && styles.invalidInput}`}>{children}</div>
      </div>
      {hasHelp && (
        <div className={`px-6 py-4 border-t bg-background text-textLight font-thin  rounded-b-lg ${styles.help}`}>
          <div className="">{help}</div>
        </div>
      )}
    </div>
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
  if (id) {
    if (id === "new") {
      if (clone) {
        return <SingleObjectEditorLoader {...props} id={clone} clone={true} />;
      } else {
        return <SingleObjectEditor {...props} />;
      }
    } else {
      return <SingleObjectEditorLoader {...props} id={id} />;
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
          <span className="text-text font-bold">{name(record)}</span>
        </WLink>
      ),
    },
    ...listColumns.map(c => ({
      title: c.title,
      render: (text, record) => c.render(record),
    })),
    {
      title: "",
      render: (text, record) => {
        const items: MenuProps["items"] = [
          {
            label: <WLink href={`/${type}s?id=${record.id}`}>Edit</WLink>,
            key: "edit",
            icon: <EditOutlined />,
          },
          {
            label: <WLink href={`/${type}s?id=new&clone=${record.id}`}>Clone</WLink>,
            key: "clone",
            icon: <FaClone />,
          },
          {
            label: <a onClick={() => deleteObject(record.id)}>Delete</a>,
            key: "del",
            icon: <DeleteOutlined />,
          },
          ...actions.map(action => ({
            disabled: !!(action.disabled && action.disabled(record)),
            label: action.link ? (
              <WLink href={action.link(record)}>{action.title}</WLink>
            ) : (
              <a
                onClick={
                  action.action
                    ? () => {
                        (action.action as any)(record);
                      }
                    : undefined
                }
              >
                {action.title}
              </a>
            ),
            key:
              (typeof action.title === "string" ? action.title : action.link ? action.link(record) : action.key) ?? "",
            icon: <div className="w-4 h-4">{action.icon}</div>,
          })),
        ].filter(i => !!i);
        return (
          <div className="flex items-center justify-end">
            <Dropdown trigger={["click"]} menu={{ items }}>
              <div className="text-lg px-3 hover:bg-splitBorder cursor-pointer rounded-full text-center">⋮</div>
            </Dropdown>
          </div>
        );
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
