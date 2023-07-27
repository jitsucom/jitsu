import { EditorComponentProps } from "../ConfigObjectEditor/ConfigEditor";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getErrorMessage, getLog, rpc } from "juava";
import { EditorTitle } from "../ConfigObjectEditor/EditorTitle";
import { EditorBase } from "../ConfigObjectEditor/EditorBase";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { EditorField } from "../ConfigObjectEditor/EditorField";
import { ServiceConfig } from "../../lib/schema";
import { Select } from "antd";
import { EditorButtons } from "../ConfigObjectEditor/EditorButtons";
import { getConfigApi } from "../../lib/useApi";
import { feedbackError } from "../../lib/ui";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { useRouter } from "next/router";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import Nango from "@nangohq/frontend";
import { oauthDecorators } from "../../lib/server/oauth/services";
import { CheckCircleTwoTone, InfoCircleTwoTone } from "@ant-design/icons";
import set from "lodash/set";
import get from "lodash/get";
import Ajv from "ajv";
import unset from "lodash/unset";
import { SchemaForm } from "../ConfigObjectEditor/SchemaForm";
import { TextEditor } from "../ConfigObjectEditor/Editors";
import { useAntdModal } from "../../lib/modal";

type ServiceEditorProps = {} & EditorComponentProps;

const VersionSelector: React.FC<{ versions: string[]; onChange: (v: string) => void; value: string }> = ({
  versions,
  onChange,
  value,
}) => {
  const options = versions.map(v => ({ label: v, value: v }));
  return <Select onChange={onChange} value={value} options={options} className={"w-full"} />;
};

export const ServiceEditor: React.FC<ServiceEditorProps> = props => {
  const { object, meta, createNew, onCancel, onDelete, onTest, isNew, noun, loadMeta } = props;
  const appConfig = useAppConfig();
  const workspace = useWorkspace();
  const { push } = useRouter();
  const [obj, setObj] = useState<Partial<ServiceConfig>>({
    ...props.object,
  });
  const [credentials, setCredentials] = useState<any>(obj.credentials ? JSON.parse(obj.credentials) : {});
  const [isTouched, setIsTouched] = useState<boolean>(false);
  const [showErrors, setShowErrors] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [nangoLoading, setNangoLoading] = useState<boolean>(false);
  const [nangoError, setNangoError] = useState<string | undefined>(undefined);
  const [credUserProvided, setCredUserProvided] = useState(!!obj.credentials && obj.credentials !== "{}");
  const [loadingSpecs, setLoadingSpecs] = useState<boolean>(true);
  const [specs, setSpecs] = useState<any>(undefined);

  const oauthConnector = oauthDecorators.find(d => d.packageId === obj.package);
  const [manualAuth, setManualAuth] = useState(typeof oauthConnector === "undefined");
  const ajv = useMemo(
    () => new Ajv({ allErrors: true, strictSchema: false, useDefaults: true, allowUnionTypes: true }),
    []
  );
  const modal = useAntdModal();

  const change = useCallback(
    (key: string, value: any) => {
      setObj({
        ...obj,
        [key]: value,
      });
      setIsTouched(true);
    },
    [obj]
  );

  useEffect(() => {
    if (specs) {
      return;
    }
    (async () => {
      console.log("Loading specs");
      setLoadingSpecs(true);
      try {
        const firstRes = await rpc(`/api/${workspace.id}/sources/spec?package=${obj.package}&version=${obj.version}`);
        if (firstRes.ok) {
          console.log("Loaded cached specs:", JSON.stringify(firstRes, null, 2));
          setSpecs(firstRes.specs);
          if (!credUserProvided) {
            change("credentials", JSON.stringify(firstRes.fakeJson, null, 2));
          }
        } else if (firstRes.error) {
          feedbackError(`Cannot load specs for ${obj.package}:${obj.version} error: ${firstRes.error}`);
          return;
        } else {
          for (let i = 0; i < 60; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const resp = await rpc(
              `/api/${workspace.id}/sources/spec?package=${obj.package}&version=${obj.version}&after=${firstRes.startedAt}`
            );
            if (!resp.pending) {
              if (resp.error) {
                feedbackError(`Cannot load specs for ${obj.package}:${obj.version} error: ${resp.error}`);
                return;
              } else {
                console.log("Loaded specs:", JSON.stringify(resp, null, 2));
                setSpecs(resp.specs);
                if (!credUserProvided) {
                  change("credentials", JSON.stringify(resp.fakeJson, null, 2));
                }
                return;
              }
            }
          }
          feedbackError(`Cannot load specs for ${obj.package}:${obj.version} error: Timeout`);
        }
      } catch (error) {
        feedbackError(`Cannot load specs for ${obj.package}:${obj.version} error: ${error}`);
      } finally {
        setLoadingSpecs(false);
      }
    })();
  }, [workspace.id, credUserProvided, obj.package, obj.version, change, specs]);

  const validate = useCallback(() => {
    const validate = ajv.compile(specs.connectionSpecification);
    const valid = validate(credentials);
    const errors: string[] = [];
    if (!obj.name) {
      errors.push("[required] Object must have required property 'name'");
    }
    if (!valid || errors.length > 0) {
      errors.push(
        ...(validate.errors ?? []).reduce((acc: string[], err) => {
          acc.push(`${err.instancePath || "Object"} ${err.message}`);
          return acc;
        }, [])
      );
      setShowErrors(true);
      modal.error({
        title: "There are errors in the configuration",
        style: { width: "600px" },
        content: (
          <div>
            Please fix following errors. Fields with errors are marked with red{" "}
            <ul className="block mt-2 ml-5">
              {errors.map((e: any, i) => {
                return (
                  <li className="list-disc" key={i}>
                    {e}
                  </li>
                );
              })}
            </ul>
          </div>
        ),
      });
      return false;
    }
    return true;
  }, [ajv, credentials, modal, obj.name, specs.connectionSpecification]);

  const save = useCallback(async () => {
    setLoading(true);
    try {
      if (!validate()) {
        return;
      }
      obj.credentials = JSON.stringify(credentials);
      if (props.isNew) {
        await getConfigApi(workspace.id, "service").create(obj);
      } else if (obj.id) {
        await getConfigApi(workspace.id, "service").update(obj.id, obj);
      } else {
        feedbackError(`Can't save service without id`);
      }
      push(`/${workspace.id}/services`);
    } catch (error) {
      feedbackError(`Can't save service`, { error });
    } finally {
      setLoading(false);
    }
  }, [validate, obj, credentials, props.isNew, push, workspace.id]);

  if (meta === undefined) {
    return <LoadingAnimation />;
  } else {
    const title = props.editorTitle
      ? props.editorTitle(object, isNew, meta)
      : isNew
      ? `Create new ${noun}`
      : `Edit ${noun}`;
    return (
      <EditorBase isTouched={isTouched} onCancel={onCancel}>
        <EditorTitle title={title} onBack={() => onCancel(isTouched)} />
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
                  nango
                    .auth(oauthConnector.nangoIntegrationId ?? "", `sync-source.${obj?.id}`)
                    .then(result => {
                      const strippedSchema = oauthConnector.stripSchema(credentials || {});
                      setObj({ ...obj, credentials: JSON.stringify(strippedSchema), authorized: true });
                      setCredentials(strippedSchema);
                      setCredUserProvided(true);
                      setNangoError(undefined);
                    })
                    .catch(err => {
                      setNangoError(getErrorMessage(err));
                      getLog().atError().log("Failed to add oauth connection", err);
                      change.bind(null, "authorized")(false);
                    })
                    .finally(() => setNangoLoading(false));
                }}
                icon={
                  <img
                    className={"w-4 h-4"}
                    alt={obj?.package}
                    src={`/api/sources/logo?type=${obj?.protocol}&package=${encodeURIComponent(obj?.package ?? "")}`}
                  />
                }
              >
                {obj?.authorized ? "Re-Sign In" : "Authorize"}
              </JitsuButton>
            </div>
            <div className={"w-full flex flex-row items-center py-1 px-2 text-text"} style={{ minHeight: 32 }}>
              {nangoError ? (
                <span className={"text-red-600"}>OAuth2 error: {nangoError}</span>
              ) : obj?.authorized ? (
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
              <JitsuButton onClick={() => setManualAuth(!manualAuth)}>
                {manualAuth ? "Hide authorization settings" : "Manually setup authorization"}
              </JitsuButton>
            </div>
          </div>
        )}
        <EditorField
          key={"name"}
          id={"name"}
          label={"Name"}
          errors={!obj.name && showErrors ? "Required" : undefined}
          required={true}
        >
          <TextEditor value={obj.name} onChange={change.bind(null, "name")} />
        </EditorField>
        <EditorField
          key={"version"}
          id={"version"}
          help={`Version of package: ${obj.package || meta.packageId}`}
          label={"Version"}
          required={true}
        >
          <VersionSelector
            value={obj.version ?? ""}
            onChange={v => {
              change.bind(null, "version")(v);
              setLoadingSpecs(true);
              setSpecs(undefined);
            }}
            versions={meta.versions}
          />
        </EditorField>
        {loadingSpecs ? (
          <LoadingAnimation
            className={"h-52"}
            title={"Loading connector specifications..."}
            longLoadingThresholdSeconds={4}
            longLoadingTitle={"It may take a little longer if it happens for the first time"}
          />
        ) : (
          !!specs && (
            <>
              <SchemaForm
                hiddenFields={!manualAuth && oauthConnector ? oauthConnector.stripSchema({}) : undefined}
                jsonSchema={specs.connectionSpecification}
                showErrors={showErrors}
                onChange={(n, v) => {
                  const newCred = { ...credentials };
                  const lastPathEl = n[n.length - 1];
                  if (v === undefined && lastPathEl.match(/^\d+$/)) {
                    //remove element from array
                    get(newCred, n.slice(0, n.length - 1)).splice(parseInt(lastPathEl), 1);
                  } else if (v === undefined || v === null || v === "") {
                    //remove element from object
                    unset(newCred, n);
                  } else {
                    set(newCred, n, v);
                  }
                  setIsTouched(true);
                  setCredentials(newCred);
                }}
                obj={credentials}
              />
            </>
          )
        )}
        <EditorButtons
          isNew={isNew}
          loading={loading}
          onDelete={onDelete}
          onCancel={() => onCancel(isTouched)}
          onSave={save}
          onTest={() => {
            if (!validate()) {
              return Promise.resolve({ ok: false, error: "Config validation failed" });
            }
            return onTest!({ ...obj, credentials: JSON.stringify(credentials) });
          }}
        />
      </EditorBase>
    );
  }
};
