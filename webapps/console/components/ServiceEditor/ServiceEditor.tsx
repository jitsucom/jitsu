import { EditorComponentProps } from "../ConfigObjectEditor/ConfigEditor";
import React, { useCallback, useEffect, useState } from "react";
import { getErrorMessage, getLog, rpc } from "juava";
import { EditorTitle } from "../ConfigObjectEditor/EditorTitle";
import { EditorBase } from "../ConfigObjectEditor/EditorBase";
import { LoadingAnimation } from "../GlobalLoader/GlobalLoader";
import { EditorField } from "../ConfigObjectEditor/EditorField";
import { TextEditor } from "../ConnectionEditorPage/ConnectionEditorPage";
import { ServiceConfig } from "../../lib/schema";
import { Button, Select } from "antd";
import { EditorButtons } from "../ConfigObjectEditor/EditorButtons";
import { getConfigApi } from "../../lib/useApi";
import { feedbackError } from "../../lib/ui";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { useRouter } from "next/router";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import Nango from "@nangohq/frontend";
import { oauthDecorators } from "../../lib/server/oauth/services";
import { CodeEditor } from "../CodeEditor/CodeEditor";
import { CheckCircleTwoTone, InfoCircleTwoTone } from "@ant-design/icons";

const log = getLog("ServiceEditor");

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
  const [formState, setFormState] = useState<any | undefined>(undefined);
  const isTouched = formState !== undefined || !!createNew;
  const [loading, setLoading] = useState<boolean>(false);
  const [nangoLoading, setNangoLoading] = useState<boolean>(false);
  const [nangoError, setNangoError] = useState<string | undefined>(undefined);
  const [credUserProvided, setCredUserProvided] = useState(!!obj.credentials && obj.credentials !== "{}");
  const [loadingSpecs, setLoadingSpecs] = useState<boolean>(false);
  const [specs, setSpecs] = useState<any>(undefined);

  const oauthConnector = oauthDecorators.find(d => d.packageId === obj.package);

  const change = useCallback(
    (key: string, value: any) => {
      setObj({
        ...obj,
        [key]: value,
      });
    },
    [obj]
  );

  useEffect(() => {
    if (credUserProvided || specs) {
      console.log("No need to load specs. Credentials are already filled.");
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
          change("credentials", JSON.stringify(firstRes.fakeJson, null, 2));
        } else {
          for (let i = 0; i < 60; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log(
              "Loading specs attempt",
              `/api/${workspace.id}/sources/spec?package=${obj.package}&version=${obj.version}&after=${firstRes.startedAt}`
            );
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
                change("credentials", JSON.stringify(resp.fakeJson, null, 2));
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

  const save = useCallback(async () => {
    setLoading(true);
    try {
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
  }, [props.isNew, obj, workspace.id, push]);

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
        <EditorField key={"name"} id={"name"} label={"Name"} required={true}>
          <TextEditor className="w-full" value={obj.name} onChange={change.bind(null, "name")} />
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
              setSpecs(undefined);
            }}
            versions={meta.versions}
          />
        </EditorField>
        <EditorField key={"credentials"} id={"credentials"} label={"Credentials"} required={true}>
          {loadingSpecs ? (
            <LoadingAnimation className={"h-52"} title={"Loading connector specifications..."} />
          ) : (
            <div>
              {oauthConnector && (
                <div className={"flex flex-row items-center gap-3 mb-2"}>
                  <div>
                    <JitsuButton
                      type={"primary"}
                      ghost={true}
                      loading={nangoLoading}
                      onClick={() => {
                        const nango = new Nango({ publicKey: appConfig.nango!.publicKey, host: appConfig.nango!.host });
                        setNangoLoading(true);
                        nango
                          .auth(oauthConnector.nangoIntegrationId ?? "", `sync-source.${obj?.id}`)
                          .then(result => {
                            const strippedSchema = JSON.stringify(
                              oauthConnector.stripSchema(JSON.parse(obj?.credentials ?? "{}")),
                              null,
                              4
                            );
                            setObj({ ...obj, credentials: strippedSchema, authorized: true });
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
                          src={`/api/sources/logo?type=${obj?.protocol}&package=${encodeURIComponent(
                            obj?.package ?? ""
                          )}`}
                        />
                      }
                    >
                      {obj?.authorized ? "Re-Sign In" : "Authorize"}
                    </JitsuButton>
                  </div>
                  <span>
                    {nangoError ? (
                      <span className={"text-red-600"}>OAuth2 error: ${nangoError}</span>
                    ) : obj?.authorized ? (
                      <div
                        className={
                          "rounded-lg flex flex-row items-center border border-gray-200 py-1 px-3.5 h-8 text-text"
                        }
                      >
                        <CheckCircleTwoTone twoToneColor={"#1fcc00"} className={"mr-2"} />
                        Authorized
                      </div>
                    ) : (
                      <div
                        className={
                          "rounded-lg flex flex-row items-center border border-gray-200 py-1 px-3.5 h-8 text-text"
                        }
                      >
                        <InfoCircleTwoTone className={"mr-2"} />
                        Click "Authorize" to open OAuth2.0 authorization popup
                      </div>
                    )}
                  </span>
                </div>
              )}
              <div className={"relative"}>
                <div className={"absolute top-2 right-2 z-50"}>
                  <Button
                    type={"primary"}
                    ghost={true}
                    size={"small"}
                    onClick={() => {
                      setSpecs(undefined);
                      setCredUserProvided(false);
                    }}
                  >
                    Generate example
                  </Button>
                </div>
                <div className={`border border-textDisabled`}>
                  <CodeEditor
                    value={obj.credentials ?? "{}"}
                    onChange={v => {
                      change.bind(null, "credentials")(v);
                      setCredUserProvided(true);
                    }}
                    language={"json"}
                    height={"206px"}
                  />
                </div>
              </div>
            </div>
          )}
        </EditorField>
        <EditorButtons
          isNew={isNew}
          loading={loading}
          onDelete={onDelete}
          onCancel={() => onCancel(isTouched)}
          onSave={save}
          onTest={() => onTest!(obj)}
        />
      </EditorBase>
    );
  }
};
