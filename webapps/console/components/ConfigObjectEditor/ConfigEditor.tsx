import React, { createContext, PropsWithChildren, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Button, Col, Form as AntdForm, Input, Row, Switch, Table } from "antd";
import { FaCaretDown, FaCaretRight, FaClone, FaPlus } from "react-icons/fa";
import { ZodType } from "zod";
import { ConfigApiDeleteOptions, getConfigApi } from "../../lib/useApi";
import { useRouter } from "next/router";
import { asFunction, FunctionLike, getErrorMessage, getLog, requireDefined } from "juava";

import zodToJsonSchema from "zod-to-json-schema";

import styles from "./ConfigEditor.module.css";

import validator from "@rjsf/validator-ajv8";
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
import { useAppConfig, useWorkspace, useWorkspaceRole } from "../../lib/context";
import { useEeApi } from "../../lib/eeApi";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { WLink } from "../Workspace/WLink";
import { CheckCircleTwoTone, DeleteOutlined, InfoCircleTwoTone } from "@ant-design/icons";
import {
  Action,
  confirmOp,
  copyTextToClipboard,
  doAction,
  feedbackError,
  feedbackSuccess,
  useTitle,
} from "../../lib/ui";
import { branding } from "../../lib/branding";
import { useAntdModal } from "../../lib/modal";
import { Copy, Edit3, Inbox, Search } from "lucide-react";
import { createDisplayName } from "../../lib/zod";
import { useQueryStringState } from "../../lib/useQueryStringState";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { EditorTitle } from "./EditorTitle";
import { EditorBase } from "./EditorBase";
import { EditorField } from "./EditorField";
import { EditorButtons } from "./EditorButtons";
import { ButtonGroup, ButtonProps } from "../ButtonGroup/ButtonGroup";
import cuid from "cuid";
import { ObjectTitle } from "../ObjectTitle/ObjectTitle";
import omitBy from "lodash/omitBy";
import {
  asConfigType,
  useConfigObject,
  useConfigObjectList,
  useConfigObjectMutation,
  useStoreReload,
} from "../../lib/store";
import { CustomWidgetProps, PasswordEditor } from "./Editors";
import { WorkspacePermissionsType } from "../../lib/workspace-roles";
import { oauthDecorators } from "../../lib/server/oauth/destinations";
import Nango from "@nangohq/frontend";

const log = getLog("ConfigEditor");

/**
 * Handles deletion of config objects with strict mode and cascade delete support
 */
async function handleConfigObjectDelete(params: {
  type: string;
  noun: string;
  id: string;
  deleteFn: (options?: ConfigApiDeleteOptions) => Promise<void>;
  modal: ReturnType<typeof useAntdModal>;
  onSuccess?: (cascade?: boolean) => void | Promise<void>;
}): Promise<void> {
  const { type, noun, id, deleteFn, modal, onSuccess } = params;
  const shouldUseStrict = ["stream", "destination", "service", "function"].includes(type);

  try {
    // Try with strict mode first for certain types
    await deleteFn(shouldUseStrict ? { strict: true } : undefined).then(onSuccess ? () => onSuccess() : undefined);
    feedbackSuccess(`Successfully deleted ${noun}`);
  } catch (error: any) {
    // Check if this is a function in use error
    if (error.response.code === "FUNCTION_IN_USE") {
      const functionData = error.response;
      const usageDetails: string[] = [];
      if (functionData.connectionsCount > 0) {
        usageDetails.push(`${functionData.connectionsCount} connection(s)`);
      }
      if (functionData.profileBuildersCount > 0) {
        usageDetails.push(`${functionData.profileBuildersCount} profile builder(s)`);
      }
      const usageText = usageDetails.join(" and ");

      // Show confirmation modal for function deletion
      modal.confirm({
        title: `Delete ${noun} that is in use?`,
        content: (
          <div>
            <p>
              This {noun} is being used by <strong>{usageText}</strong>.
            </p>
            <p className="mt-2">
              Deleting this {noun} may cause those connections or profile builders to fail. Are you sure you want to
              continue?
            </p>
          </div>
        ),
        okText: "Delete Anyway",
        okType: "danger",
        cancelText: "Cancel",
        onOk: async () => {
          try {
            // Delete without strict mode (no cascade needed)
            await deleteFn(undefined).then(onSuccess ? () => onSuccess() : undefined);
            feedbackSuccess(`Successfully deleted ${noun}`);
          } catch (deleteError) {
            feedbackError("Failed to delete object", { error: deleteError });
          }
        },
      });
    } else if (error.response.code === "LINKED_CONNECTIONS_EXIST") {
      const linkedData = error.response;
      const connectionLabel = linkedData.linkedConnections?.every((l: any) => l.type === "sync")
        ? "Syncs"
        : linkedData.linkedConnections?.some((l: any) => l.type === "sync")
        ? "Connections and Syncs"
        : "Connections";

      // Show confirmation modal for cascade delete
      modal.confirm({
        title: `Delete ${noun} and linked ${connectionLabel}?`,
        content: (
          <div>
            <p>
              This {noun} has <strong>{linkedData.linkedConnectionsCount}</strong> linked {connectionLabel}.
            </p>
            <p className="mt-2">
              Deleting this {noun} will also delete all linked {connectionLabel.toLowerCase()}.
            </p>
          </div>
        ),
        okText: "Confirm Delete",
        okType: "danger",
        cancelText: "Cancel",
        onOk: async () => {
          try {
            await deleteFn({ cascade: true }).then(onSuccess ? () => onSuccess(true) : undefined);
            feedbackSuccess(`Successfully deleted ${noun} and all linked ${connectionLabel.toLowerCase()}`);
          } catch (cascadeError) {
            feedbackError("Failed to delete object", { error: cascadeError });
          }
        },
      });
    } else {
      feedbackError("Failed to delete object", { error });
    }
  }
}

export type FieldDisplay = {
  isId?: boolean;
  hidden?: boolean | ((a: any, isNew?: boolean) => boolean);
  displayName?: string;
  editor?: any;
  advanced?: boolean;
  documentation?: ReactNode;
  constant?: any | ((a: any, isNew?: boolean) => any);
  correction?: any | ((a: any, isNew?: boolean) => any);
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
  testConnectionEnabled?: (o: any) => boolean | "manual";
  testButtonLabel?: string;
  onTest?: (o: T) => Promise<ConfigTestResult>;
  backTo?: string;
  pathPrefix?: string;
};

type JsonSchema = any;

function getUiWidget(field: FieldDisplay, obj: any, isNew: boolean) {
  if (
    (typeof field?.hidden === "function" && field?.hidden(obj, isNew) === true) ||
    (typeof field?.hidden === "boolean" && field?.hidden === true) ||
    (typeof field?.constant === "function" && typeof field?.constant(obj, isNew) !== "undefined") ||
    (typeof field?.constant !== "function" && typeof field?.constant !== "undefined")
  ) {
    return "hidden";
  } else if (field?.editor) {
    return field?.editor;
  } else if (field?.password) {
    return "password";
  } else if (field?.textarea) {
    return "textarea";
  } else {
    return undefined;
  }
}

function getUiSchema(schema: JsonSchema, fields: Record<string, FieldDisplay>, object: any, isNew: boolean): UiSchema {
  const uiSchema = {
    ...Object.entries((schema as any).properties)
      .map(([name]) => {
        const field = fields[name];
        const fieldProps = {
          "ui:widget": getUiWidget(field, object, isNew),
          "ui:disabled": field?.constant ? true : undefined,
          "ui:placeholder": field?.constant,
          "ui:title": field?.displayName || createDisplayName(name),
          "ui:FieldTemplate": FieldTemplate,
          "ui:ObjectFieldTemplate": NestedObjectTemplate,
          "ui:help": field?.documentation || undefined,
          "ui:options": field?.password && field?.textarea ? { rows: 4 } : undefined,
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
  return uiSchema;
}

export type SingleObjectEditorProps = ConfigEditorProps & {
  object?: ConfigEntityBase & Record<string, any>;
  createNew?: boolean;
};

export const AdvancedConfiguration: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="w-full h-full mb-6">
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

export const CopyConstant: React.FC<CustomWidgetProps<string>> = props => {
  return (
    <div
      className={"rounded-md cursor-pointer relative border border-gray-300 bg-gray-50 text-textLight p-1.5 px-2.5"}
      onClick={() => {
        copyTextToClipboard(props.value);
        feedbackSuccess("Copied to clipboard");
      }}
    >
      {props.value}
      <div className={"absolute right-3 top-2.5 "}>
        <Copy className="w-3.5 h-3.5" />
      </div>
    </div>
  );
};

export const CustomCheckbox = function (props) {
  return <Switch checked={props.value} disabled={props.disabled} onClick={() => props.onChange(!props.value)} />;
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
        btnProps.onClick && btnProps.onClick(e as any);
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
    type,
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
  const appConfig = useAppConfig();
  const formRef = useRef<any>();
  const role = useWorkspaceRole();
  const [loading, setLoading] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const objectTypeFactory = asFunction<ZodType, any>(objectType);
  const schema = zodToJsonSchema(objectTypeFactory(object));
  const [formState, setFormState] = useState<any | undefined>(undefined);
  const hasErrors = formState?.errors?.length > 0;
  const [isTouched, setTouched] = useState<boolean>(!!createNew);
  const [testResult, setTestResult] = useState<any>(undefined);
  const [nangoLoading, setNangoLoading] = useState<boolean>(false);
  const [nangoError, setNangoError] = useState<string | undefined>(undefined);
  const oauthConnector =
    type === "destination" && appConfig.nango ? oauthDecorators[object.destinationType] : undefined;

  const uiSchema = getUiSchema(schema, fields, formState?.formData || object, isNew);

  const [submitCount, setSubmitCount] = useState(0);
  const modal = useAntdModal();

  useEffect(() => {
    if (formRef.current) {
      setFormState(formRef.current.state);
    }
  }, []);

  const onFormChange = state => {
    setFormState(state);
    setTestResult(undefined);
    setTouched(true);
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
      {oauthConnector && (
        <div className={"flex flex-row items-center gap-3 mb-4"}>
          <div>
            <JitsuButton
              type={"primary"}
              size={"large"}
              ghost={true}
              loading={nangoLoading}
              onClick={() => {
                const nango = new Nango({
                  publicKey: appConfig.nango!.publicKey,
                  host: appConfig.nango!.host,
                });
                setNangoLoading(true);
                const oauthIntegrationId = oauthConnector.nangoIntegrationId(formState?.formData || object);
                const oauthConnectionId = `destination.${object?.id}`;
                nango
                  .auth(oauthIntegrationId, oauthConnectionId)
                  .then(result => {
                    if (formState) {
                      formState.formData = {
                        ...formState.formData,
                        authorized: true,
                        oauthIntegrationId,
                        oauthConnectionId,
                      };
                      setTouched(true);
                    }
                    setNangoError(undefined);
                  })
                  .catch(err => {
                    setNangoError(getErrorMessage(err));
                    getLog().atError().log("Failed to add oauth connection", err);
                    if (formState) {
                      formState.formData = { ...formState.formData, authorized: false };
                      setTouched(true);
                    }
                  })
                  .finally(() => setNangoLoading(false));
              }}
            >
              {(formState?.formData || object).authorized ? "Re-Sign In" : "Authorize"}
            </JitsuButton>
          </div>
          <div className={"w-full flex flex-row items-center py-1 px-2 text-text"} style={{ minHeight: 32 }}>
            {nangoError ? (
              <span className={"text-red-600"}>OAuth2 error: {nangoError}</span>
            ) : (formState?.formData || object).authorized ? (
              <>
                <CheckCircleTwoTone twoToneColor={"#1fcc00"} className={"mr-2"} />
                Authorized
              </>
            ) : (
              <>
                <InfoCircleTwoTone className={"mr-2"} />
                Click "Authorize" to open OAuth2.0 authorization popup
              </>
            )}
          </div>
          <div>
            {/*<JitsuButton onClick={() => setManualAuth(!manualAuth)}>*/}
            {/*  {manualAuth ? "Hide authorization settings" : "Manually setup authorization"}*/}
            {/*</JitsuButton>*/}
          </div>
        </div>
      )}
      <EditorComponentContext.Provider value={{ displayInlineErrors: !isNew || submitCount > 0 }}>
        <Form
          ref={formRef}
          formContext={props}
          templates={{ ObjectFieldTemplate: FormList, ButtonTemplates: { AddButton } }}
          widgets={{ CheckboxWidget: CustomCheckbox, password: PasswordEditor }}
          omitExtraData={true}
          liveOmit={true}
          disabled={!role.editEntities}
          showErrorList={false}
          onChange={onFormChange}
          className={styles.editForm}
          schema={schema as any}
          liveValidate={true}
          validator={validator}
          onSubmit={async ({ formData }) => {
            if (
              onTest &&
              (typeof testConnectionEnabled === "undefined" || testConnectionEnabled(formData || object) === true)
            ) {
              setTesting(true);
              let testRes: any;
              try {
                testRes = testResult || (await onTest(formState?.formData || object));
              } finally {
                setTesting(false);
              }
              if (!testRes?.ok) {
                modal.confirm({
                  title: "Check failed",
                  content: testRes?.error,
                  okText: "Save anyway",
                  okType: "danger",
                  cancelText: "Cancel",
                  onOk: () => {
                    withLoading(() => onSave({ ...formData, testConnectionError: testRes?.error }))();
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
            testing={testing}
            isNew={isNew}
            isTouched={isTouched}
            hasErrors={hasErrors}
            testButtonLabel={props.testButtonLabel}
            onTest={
              onTest && testConnectionEnabled && testConnectionEnabled(formState?.formData || object)
                ? async () => {
                    const testResult = await onTest(formState?.formData || object);
                    setTestResult(testResult);
                    return testResult;
                  }
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
    pathPrefix = "",
    ...otherProps
  } = props;
  const pref = pathPrefix;
  const [meta, setMeta] = useState<any>(undefined);
  const isNew = !!(!otherProps.object || createNew);
  const workspace = useWorkspace();
  const appConfig = useAppConfig();
  const router = useRouter();
  const reloadStore = useStoreReload();
  const { eeRpc } = useEeApi();

  const onSaveMutation = useConfigObjectMutation(type as any, async (newObject: any) => {
    if (isNew) {
      await getConfigApi(workspace.id, type).create(newObject);
      if (type === "stream" && appConfig.ee.available) {
        try {
          await eeRpc("s3-init", { method: "GET", query: { workspaceId: workspace.id } });
        } catch (e: any) {
          console.error("Failed to init S3 bucket", e.message);
        }
      }
    } else {
      await getConfigApi(workspace.id, type).update(object.id, newObject);
    }
  });

  const modal = useAntdModal();

  const onDeleteMutation = useConfigObjectMutation(
    type as any,
    async (options?: ConfigApiDeleteOptions) => {
      await getConfigApi(workspace.id, type).del(object.id, options);
    },
    `/${workspace.slugOrId}${pref}/${type}s`
  );

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
  const preObject = otherProps.object || {
    id: cuid(),
    workspaceId: workspace.id,
    type: type,
    ...newObject(meta),
  };
  const constants = Object.fromEntries(
    Object.entries(fields)
      .filter(([_, v]) => typeof v.constant !== "undefined")
      .map(([k, v]) => [k, typeof v.constant === "function" ? v.constant(preObject, isNew) : v.constant])
  );
  const corrections = Object.fromEntries(
    Object.entries(fields)
      .filter(([_, v]) => typeof v.correction !== "undefined")
      .map(([k, v]) => [k, typeof v.correction === "function" ? v.correction(preObject, isNew) : v.correction])
  );

  const object = { ...preObject, ...constants, ...corrections };

  const onCancel = async (confirm: boolean) => {
    if (!confirm || (await confirmOp("Are you sure you want to close this page? All unsaved changes will be lost."))) {
      if (backTo) {
        router.push(`/${workspace.slugOrId}${backTo}`);
      } else {
        router.push(`/${workspace.slugOrId}${pref}/${type}s`);
      }
    }
  };
  const onDelete = async () => {
    if (!(await confirmOp(`Are you sure you want to delete this ${noun}?`))) {
      return;
    }

    await handleConfigObjectDelete({
      type,
      noun,
      id: object.id,
      deleteFn: async options => {
        await onDeleteMutation.mutateAsync(options);
      },
      modal,
      onSuccess: async cascade => {
        if (cascade) {
          //reload store to reflect cascade delete
          await reloadStore();
        }
      },
    });
  };
  const onSave = async newObject => {
    try {
      await onSaveMutation.mutateAsync(newObject);
      if (backTo) {
        router.push(`/${workspace.slugOrId}${backTo}`);
      } else {
        router.push(`/${workspace.slugOrId}${pref}/${type}s`);
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

const SingleObjectEditorLoader: React.FC<ConfigEditorProps & { id: string; clone?: string }> = ({
  id,
  clone,
  ...rest
}) => {
  const data = requireDefined(useConfigObject(asConfigType(rest.type), id), `Unknown ${rest.type} ${id}`);
  return (
    <SingleObjectEditor
      {...rest}
      createNew={!!clone}
      object={
        clone
          ? {
              ...data,
              id: cuid(),
              cloneId: clone,
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
        return <SingleObjectEditorLoader {...props} id={clone} backTo={backTo} clone={clone} />;
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
  pathPrefix = "",
}) => {
  const pref = pathPrefix;
  const modal = useAntdModal();
  const nameRender = listColumns.find(c => c.title === "name")?.render;
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
      render:
        nameRender ||
        ((text, record) => (
          <WLink href={`${pref}/${type}s?id=${record.id}`}>
            <ObjectTitle title={name(record)} icon={icon ? icon(record) : undefined} />
          </WLink>
        )),
    },
    ...listColumns
      .filter(c => c.title !== "name")
      .map(c => ({
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
            href: `${pref}/${type}s?id=${record.id}`,
            icon: <Edit3 className={"w-4 h-4"} />,
            requiredPermission: "editEntities" as WorkspacePermissionsType,
          },
          ...actions.map(action => ({
            disabled: !!(action.disabled && action.disabled(record)),
            href: action.link ? action.link(record) : undefined,
            label: action.title,
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
            href: `${pref}/${type}s?id=new&clone=${record.id}`,
            collapsed: true,
            icon: <FaClone />,
            requiredPermission: "editEntities" as WorkspacePermissionsType,
          },
          {
            label: "Delete",
            danger: true,
            collapsed: true,
            onClick: () => deleteObject(record.id),
            icon: <DeleteOutlined />,
            requiredPermission: "deleteEntities" as WorkspacePermissionsType,
          },
        ].filter(i => !!i);
        return <ButtonGroup items={items} />;
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
  const data = useConfigObjectList(asConfigType(props.type));
  const router = useRouter();
  const modal = useAntdModal();
  const pluralNoun = props.nounPlural || plural(props.noun);
  const addAction = props.addAction || (() => router.push(`${router.asPath}?id=new`));
  const reloadStore = useStoreReload();
  const [searchQuery, setSearchQuery] = useQueryStringState("search", { defaultValue: "", skipHistory: true });

  const onDeleteMutation = useConfigObjectMutation(
    props.type as any,
    async (params: { id: string; query?: ConfigApiDeleteOptions }) => {
      await getConfigApi(workspace.id, props.type).del(params.id, params.query);
    }
  );
  const onDelete = async (id: string) => {
    await handleConfigObjectDelete({
      type: props.type,
      noun: props.noun,
      id,
      deleteFn: async options => {
        await onDeleteMutation.mutateAsync({ id, query: options });
      },
      modal,
      onSuccess: async cascade => {
        if (cascade) {
          //reload store to reflect cascade delete
          await reloadStore();
        }
      },
    });
  };
  const list = (data.filter(props.filter || (() => true)) || []).filter(obj => {
    if (!searchQuery) return true;
    const q = searchQuery.trim().toLowerCase();
    return obj.id?.toLowerCase().includes(q) || (obj as any).name?.toLowerCase().includes(q);
  });
  return (
    <div>
      <div className="flex justify-between pb-6">
        <div className="flex items-center gap-6">
          <div className="text-3xl">{props.listTitle || `Edit ${pluralNoun}`}</div>
          <Input
            placeholder="Filter by ID or name..."
            prefix={<Search className="w-3.5 h-3.5 text-textDisabled" />}
            allowClear
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-96 mt-0.5"
            size="small"
          />
        </div>
        <div>
          <JitsuButton
            onClick={() => doAction(router, addAction)}
            type="primary"
            size="large"
            icon={<FaPlus />}
            requiredPermission="editEntities"
          >
            Add new {props.noun}
          </JitsuButton>
        </div>
      </div>
      <div>
        {list.length === 0 && (
          <div>
            <div className="flex flex-col items-center">
              <Inbox className="h-16 w-16 my-6 text-neutral-200" />
              <div className="text text-textLight mb-6">You don't have any {props.noun}s configured.</div>

              <JitsuButton type="default" onClick={() => doAction(router, addAction)} requiredPermission="editEntities">
                {props.createKeyword || "Create"} your first {props.noun}
              </JitsuButton>
            </div>
          </div>
        )}
        {list.length > 0 && <ObjectsList {...props} objects={list} onDelete={onDelete} />}
      </div>
    </div>
  );
};
export { ConfigEditor };
