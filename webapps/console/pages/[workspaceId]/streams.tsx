import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { Button, Input, notification, Tag, Tooltip } from "antd";
import { ConfigEditor, ConfigEditorProps, CustomCheckbox } from "../../components/ConfigObjectEditor/ConfigEditor";
import { StreamConfig } from "../../lib/schema";
import { useAppConfig, useWorkspace } from "../../lib/context";
import React, { PropsWithChildren, useMemo, useState } from "react";
import Link from "next/link";
import { FaExternalLinkAlt, FaSpinner, FaTrash, FaWrench } from "react-icons/fa";
import { branding } from "../../lib/branding";
import { useRouter } from "next/router";
import { TrackingIntegrationDocumentation } from "../../components/TrackingIntegrationDocumentation/TrackingIntegrationDocumentation";
import { BrowserKeysEditor } from "../../components/ApiKeyEditor/ApiKeyEditor";
import { useQuery } from "@tanstack/react-query";
import { getEeClient } from "../../lib/ee-client";
import { requireDefined } from "juava";
import { ReloadOutlined } from "@ant-design/icons";
import { confirmOp, feedbackError, feedbackSuccess } from "../../lib/ui";
import { getAntdModal, useAntdModal } from "../../lib/modal";
import { get, getConfigApi } from "../../lib/useApi";
import { Activity, AlertTriangle, Check, Globe, Wrench, Zap } from "lucide-react";
import { FaviconLoader } from "./index";
import { ObjectTitle } from "../../components/ObjectTitle/ObjectTitle";
import omit from "lodash/omit";
import { CustomWidgetProps } from "../../components/ConfigObjectEditor/Editors";
import { toURL } from "../../lib/shared/url";
import JSON5 from "json5";
import { EditorToolbar } from "../../components/EditorToolbar/EditorToolbar";
import { DomainCheckResponse } from "../../lib/shared/domain-check-response";
import { useConfigObjectLinks, useConfigObjectList } from "../../lib/store";

const Streams: React.FC<any> = () => {
  return (
    <WorkspacePageLayout>
      <StreamsList />
    </WorkspacePageLayout>
  );
};

const StatusBadge: React.FC<
  PropsWithChildren<{ status: "error" | "warning" | "info" | "success" | "loading"; className?: string }>
> = ({ status, children, className }) => {
  let color: string | undefined;
  let defaultDescription: string;
  if (status === "error") {
    color = "red";
    defaultDescription = "Error";
  } else if (status === "success") {
    color = "cyan";
    defaultDescription = "Success";
  } else if (status === "info") {
    color = "geekblue";
    defaultDescription = "Info";
  } else if (status === "warning") {
    color = "orange";
    defaultDescription = "Warning";
  } else {
    color = undefined;
    defaultDescription = "Loading";
  }
  return <Tag color={color}>{children || defaultDescription}</Tag>;
};

function displayErrorFeedback(opts?: { message?: string; error?: any }) {
  notification.open({
    message: "An error occurred while processing your request. Please try again later.",
    description: `Error: ${opts?.message || opts?.error?.message || opts?.error?.toString() || "Unknown error"}`,
    onClick: () => {
      //console.log("Notification Clicked!");
    },
  });
}

const CustomDomain: React.FC<{ domain: string; deleteDomain: () => Promise<void> }> = ({ domain, deleteDomain }) => {
  const appConfig = useAppConfig();
  const workspace = useWorkspace();

  const eeClient = useMemo(
    () => getEeClient(requireDefined(appConfig.ee.host, `EE is not available`), workspace.id),
    [appConfig.ee.host, workspace.id]
  );
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const { data, isLoading, error, refetch } = useQuery<DomainCheckResponse>(
    ["domain-status", domain.toLowerCase(), reloadTrigger],
    async () => {
      return await get(`/api/${workspace.id}/domain-check?domain=${domain.toLowerCase()}`);
    },
    { cacheTime: 0 }
  );
  const m = useAntdModal();
  return (
    <div className={"rounded-lg border py-2 pl-4 hover:bg-backgroundDark"}>
      <>
        <div className="flex items-center">
          {/*<div>*/}
          {/*  <FaCaretRight />*/}
          {/*</div>*/}
          <div className={"text-blue-600 w-4 h-4 mr-1.5"}>
            <Globe
              className={`w-full h-full ${error ? "text-red-600" : data?.ok ? "text-blue-600" : "text-yellow-600"}`}
            />
          </div>
          <div className="font-bold  text-lg">{domain}</div>
          <div className="flex-grow flex items-center justify-end">
            <Tooltip title={`Open ${domain} site in a new tab`}>
              <Button
                type="text"
                onClick={() => {
                  window.open(`https://${domain}`, "_blank");
                }}
                disabled={deleting}
                className="border-0"
              >
                <FaExternalLinkAlt />
              </Button>
            </Tooltip>
            {data?.reason === "requires_cname_configuration" && (
              <Tooltip title="See configuration instructions">
                <Button
                  type="text"
                  danger
                  disabled={isLoading || deleting}
                  onClick={() => {
                    DomainConfigurationInstructions.show({ domain, status: data! });
                  }}
                  className="border-0"
                >
                  <FaWrench />
                </Button>
              </Tooltip>
            )}
            <Tooltip title="Re-check domain status">
              <Button
                type="text"
                disabled={isLoading || deleting}
                onClick={() => {
                  setReloadTrigger(reloadTrigger + 1);
                }}
                className="border-0"
              >
                <ReloadOutlined />
              </Button>
            </Tooltip>
            <Button
              type="text"
              disabled={deleting}
              loading={deleting}
              onClick={async () => {
                if (await confirmOp(`Are you sure you want to remove domain ${domain}?`)) {
                  try {
                    setDeleting(true);
                    await deleteDomain();
                  } catch (e) {
                    displayErrorFeedback({ message: `Can't remove domain ${domain}`, error: e });
                  } finally {
                    setDeleting(false);
                  }
                }
              }}
              className="border-0"
            >
              {!deleting && <FaTrash />}
            </Button>
          </div>
        </div>
        <div className="flex items-center mt-1">
          <div className={"mr-2"}>Status:</div>
          {(() => {
            if (isLoading) {
              return (
                <StatusBadge status="loading">
                  <span className={"flex items-center"}>
                    <FaSpinner className="animate-spin mr-1" />
                    Checking Domain Status
                  </span>
                </StatusBadge>
              );
            } else if (data?.ok) {
              return <StatusBadge status="success">OK</StatusBadge>;
            } else if (data?.reason === "requires_cname_configuration") {
              return <StatusBadge status="warning">Configuration Required</StatusBadge>;
            } else if (data?.reason === "pending_ssl") {
              return <StatusBadge status="info">Issuing Certificate</StatusBadge>;
            } else {
              return <StatusBadge status="error">{data?.reason || "ERROR"}</StatusBadge>;
            }
          })()}
        </div>
        {error && (
          <div className="flex items-start mt-1">
            <div className={"mr-2"}>Description:</div>
            <div className="">{`${"Internal error"}`}</div>
          </div>
        )}
        {data?.reason === "requires_cname_configuration" && (
          <div className="flex items-start mt-1">
            <div className={"mr-2"}>Description:</div>
            <div className="">
              See{" "}
              <a
                className={"cursor-pointer"}
                onClick={() => DomainConfigurationInstructions.show({ domain, status: data! })}
              >
                <u>configuration instructions</u>
              </a>
            </div>
          </div>
        )}
        {data?.reason === "pending_ssl" && (
          <div className="flex items-start mt-1">
            <div className={"mr-2"}>Description:</div>
            <div className="">Issuing SSL certificate for the domain. It may take up to 10 minutes.</div>
          </div>
        )}
      </>
    </div>
  );
};
export type DNSRecordTableProps = {
  records: { domain: string; type: string; value: string }[];
};

export const DNSRecordTable: React.FC<DNSRecordTableProps> = ({ records }) => {
  return (
    <table>
      <thead>
        <tr className="font-bold py-4">
          <td>Type</td>
          <td>Name</td>
          <td>Value</td>
        </tr>
      </thead>
      <tbody>
        {records.map(({ domain, type, value }) => (
          <tr key={name + type + value} className="font-mono">
            <td className="pr-4">{type}</td>
            <td className="pr-4">{domain}</td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export type DomainInstructionsProps = { domain: string; status: DomainCheckResponse };
const DomainConfigurationInstructions: React.FC<DomainInstructionsProps> & {
  show: (p: DomainInstructionsProps) => void;
} = ({ domain, status }) => {
  if (status.reason === "requires_cname_configuration") {
    return (
      <div>
        <h3>Set the following record on your DNS provider to continue</h3>
        <p className="bg-bgLight py-2 my-4">
          <DNSRecordTable records={[{ type: "CNAME", domain, value: status.cnameValue! }]} />
        </p>
      </div>
    );
  } else {
    return <div>Unknown configuration type</div>;
  }
};

DomainConfigurationInstructions.show = p => {
  getAntdModal().info({
    width: "90vw",
    style: { maxWidth: "48rem" },
    title: (
      <h2 className="text-2xl">
        <code>{p.domain}</code> configuration instructions
      </h2>
    ),
    content: <DomainConfigurationInstructions {...p} />,
  });
};

const DomainsEditor: React.FC<CustomWidgetProps<string[]>> = props => {
  const [domains, setDomains] = useState<string[]>(props.value || []);
  const [addValue, setAddValue] = useState<string | undefined>();
  const [addPending, setAddPending] = useState(false);
  const workspace = useWorkspace();
  const add = async () => {
    setAddPending(true);
    try {
      const available: DomainCheckResponse = await get(`/api/${workspace.id}/domain-check?domain=${addValue}`);
      if (!available.ok) {
        if (available.reason === "used_by_other_workspace") {
          feedbackError(
            <>
              Domain <code>{addValue}</code> is not available. It is used by other workspace. Contact{" "}
              <code>support@jitsu.com</code> if you think this is a mistake
            </>
          );
          return;
        } else if (available.reason === "invalid_domain_name") {
          feedbackError(
            <>
              Invalid domain name <code>{addValue}</code>
            </>
          );
          return;
        }
      }
      const newVal = [...domains, addValue as string];
      setDomains(newVal);
      setAddValue(undefined);
      props.onChange(newVal);
    } catch (e) {
      feedbackError(`Can't add domain ${addValue}`, { error: e });
    } finally {
      setAddPending(false);
    }
  };
  return (
    <div>
      <div className="flex">
        <Input
          placeholder="subdomain.mywebsite.com"
          value={addValue}
          onChange={e => setAddValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              add();
              e.preventDefault();
            }
          }}
        />
        <Button disabled={!addValue} className="ml-5" onClick={add} loading={addPending}>
          Add
        </Button>
      </div>
      <div className="mt-5">
        {domains.map(domain => (
          <div key={domain} className="mb-4">
            <CustomDomain
              domain={domain}
              deleteDomain={async () => {
                const newVal = domains.filter(d => d !== domain);
                setDomains(newVal);
                props.onChange(newVal);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export const StreamTitle: React.FC<{
  stream?: StreamConfig;
  size?: "small" | "default" | "large";
  title?: (s: StreamConfig) => string | React.ReactNode;
  link?: boolean;
}> = ({ stream, title = s => s.name, size = "default", link }) => {
  return (
    <ObjectTitle
      icon={<FaviconLoader potentialUrl={stream?.name} />}
      size={size}
      href={stream && link ? `/${stream.workspaceId}/streams?id=${stream?.id}` : undefined}
      title={stream ? title(stream) : "Unknown stream"}
    />
  );
};

const StreamsList: React.FC<{}> = () => {
  const workspace = useWorkspace();
  const noun = "site";
  const router = useRouter();
  const appConfig = useAppConfig();

  const streams = useConfigObjectList("stream");
  const connections = useConfigObjectLinks({ type: "push" });

  const [implementationDocumentationId, setImplementationDocumentationId] = useState<string | undefined>(
    router.query.implementationFor as string | undefined
  );
  const config: ConfigEditorProps<StreamConfig> = {
    subtitle: (obj, isNew) =>
      !isNew && (
        <EditorToolbar
          items={[
            {
              title: "Setup Instructions",
              icon: <Wrench className="w-full h-full" />,
              href: `/${workspace.slugOrId}/streams?id=${obj.id}&implementationFor=${obj.id}`,
              onClick: () => {
                setImplementationDocumentationId(obj.id);
              },
            },
            {
              title: "Live Events",
              icon: <Activity className="w-full h-full" />,
              href: toURL(`/${workspace.slugOrId}/data`, {
                query: JSON5.stringify({
                  activeView: "incoming",
                  viewState: { incoming: { actorId: obj.id } },
                }),
              }),
            },
            {
              title: "Connected Destinations",
              icon: <Zap className="w-full h-full" />,
              href: `/${workspace.slugOrId}/connections?source=${obj.id}`,
            },
          ]}
          className="mb-4"
        />
        // <div className="mb-4 flex items-center justify-left">
        //
        //   <Link
        //     href={`/${workspace.slug || workspace.id}/streams?id=${obj.id}&implementationFor=${obj.id}`}
        //     onClick={() => {
        //       router.replace(`/${workspace.slug || workspace.id}/streams?id=${obj.id}&implementationFor=${obj.id}`);
        //       setImplementationDocumentationId(obj.id);
        //     }}
        //     className="flex items-center space-x-2 border border-textLight px-2 py-1 rounded text-textLight text-xs"
        //   >
        //     <Wrench className="h-4 w-4" />
        //     <span>Setup Instructions</span>
        //   </Link>
        // </div>
      ),
    objectType: StreamConfig,
    newObject: () => {
      return { strict: true };
    },
    onChange: async (isNew, olddata, newdata, id) => {
      if (isNew) {
        return false;
      }
      if (id === "root_privateKeys" && (newdata.privateKeys || []).length > (olddata.privateKeys || []).length) {
        await getConfigApi(workspace.id, "stream").update(newdata.id, {
          privateKeys: newdata.privateKeys,
        });
        feedbackSuccess("Server Write Key Saved");
        return true;
      } else if (id === "root_publicKeys" && (newdata.publicKeys || []).length > (olddata.publicKeys || []).length) {
        await getConfigApi(workspace.id, "stream").update(newdata.id, {
          publicKeys: newdata.publicKeys,
        });
        feedbackSuccess("Browser Write Key Saved");
        return true;
      }
      return false;
    },
    icon: s => <FaviconLoader potentialUrl={s.name} />,
    actions: [
      {
        icon: <Wrench className="w-4 h-4" />,
        title: "Setup Instructions",
        collapsed: true,
        action: stream => {
          router.replace({
            pathname: router.pathname,
            query: { ...(router.query || {}), implementationFor: stream.id },
          });
          setImplementationDocumentationId(stream.id);
        },
      },
      {
        icon: <Activity className="w-4 h-4" />,
        link: stream =>
          toURL("/data", {
            query: JSON5.stringify({
              activeView: "incoming",
              viewState: { incoming: { actorId: stream.id } },
            }),
          }),
        title: "Live Events",
      },
      {
        icon: <Zap className="w-4 h-4" />,
        title: "Connected Destinations",
        collapsed: true,
        link: stream => `/connections?source=${stream.id}`,
      },
    ],
    listColumns: [
      ...(appConfig.publicEndpoints.dataHost || appConfig.ee.available
        ? [
            {
              title: "Domains",
              render: (s: StreamConfig) => (
                <div>
                  {[`${s.id}.${appConfig.publicEndpoints.dataHost}`, ...(s.domains || [])].map(domain => (
                    <div key={domain} className="flex items-center space-x-1">
                      <div className="font-mono">{domain}</div>
                      <a href={`https://${domain}`} target={"_blank"} rel={"noreferrer noopener"}>
                        <FaExternalLinkAlt className={"ml-0.5 w-2.5 h-2.5"} />
                      </a>
                    </div>
                  ))}
                </div>
              ),
            },
          ]
        : []),
      {
        title: "Destination Connections",
        render: (s: StreamConfig) => {
          const destinations = connections.filter(c => c.fromId === s.id);
          if (destinations.length === 0) {
            return (
              <div className="flex items-center flex-nowrap">
                <AlertTriangle className="h-4 w-4 mr-1 text-warning" />{" "}
                <span className="text-sm">
                  {destinations.length > 0 ? (
                    <Link href={`/${workspace.slugOrId}/connections/edit?serviceId=${s.id}`}>
                      Create a connection to any destination
                    </Link>
                  ) : (
                    <Link href={`/${workspace.slugOrId}/destinations`}>Create a destination</Link>
                  )}{" "}
                  to start seeing data
                </span>
              </div>
            );
          } else {
            return (
              <div className="flex items-center flex-nowrap">
                <Check className="h-4 w-4 mr-1 text-success" />{" "}
                <span className="text-sm">
                  Connected to{" "}
                  <Link href={`/${workspace.slug}/connections?source=${s.id}`}>
                    {destinations.length} destination{destinations.length > 1 ? "s" : ""}
                  </Link>
                </span>
              </div>
            );
          }
        },
      },
    ],
    onTest: async (stream: StreamConfig) => {
      if (stream.strict) {
        if (
          (!stream.privateKeys || stream.privateKeys.length === 0) &&
          (!stream.publicKeys || stream.publicKeys.length === 0)
        ) {
          return { ok: false, error: "At least one writeKey required in Strict Mode." };
        }
      }
      return { ok: true };
    },
    fields: {
      type: { constant: "stream" },
      workspaceId: { constant: workspace.id },
      strict: {
        editor: CustomCheckbox,
        displayName: "Strict Mode",
        advanced: false,
        documentation: (
          <>
            In Strict Mode, Jitsu requires a valid <b>writeKey</b> to ingest events into the current stream.
            <br />
            Without Strict Mode, if a correct writeKey is not provided, Jitsu may attempt to identify the stream based
            on the domain or, if there is only one stream in the workspace, it will automatically select that stream.
          </>
        ),
      },
      privateKeys: {
        editor: BrowserKeysEditor,
        displayName: "Server-to-server Write Keys",
        advanced: false,
        documentation: (
          <>Those keys should be kept in private and used only for server-to-server calls, such as HTTP Event API</>
        ),
      },
      publicKeys: {
        editor: BrowserKeysEditor,
        displayName: "Browser Write Keys",
        advanced: false,
        documentation: (
          <>
            Those keys are <strong>publicly accessible</strong>. They are used in client-side libraries, such as
            JavaScript.
            <br />
            Using public keys is not necessary, if you're using Custom Domains. In this case, {
              branding.productName
            }{" "}
            will authorize requests based on the domain name.
          </>
        ),
      },
      authorizedJavaScriptDomains: {
        hidden: true,
        displayName: "Authorized JavaScript Domains",
        documentation: (
          <>
            If this setting is not empty, JavaScript code from the specified domains only will be able to post data to
            {noun}. Separate multiple domains by comma. Leave the field empty to allow any domain. If you want to allow
            top level domains, and all subdomains, use wildcard as in{" "}
            <code>*.mywebsite.com,mywebsite.com,localhost</code>
          </>
        ),
      },
      domains: {
        editor: DomainsEditor,
        hidden: !appConfig.customDomainsEnabled,
        displayName: "Custom Tracking Domains",
        documentation: (
          <>
            If you want to use your own sub-domain name for tracking (such as <code>data.mywebsite.com</code>), specify
            it here. You will need to configure your DNS CNAME record to point to{" "}
            <code>{appConfig.publicEndpoints.cname || "cname.jitsu.com"}</code> domain. <br />
          </>
        ),
      },
    },
    noun: noun,
    type: "stream",
    explanation: (
      <>
        <strong>Stream</strong> is an continuous sequence of events coming from a certain source. Usually, steam is web
        or mobile application or a website. It make sense to create a stream for each environment you have. For example,
        <code>data-stage.mywebapp.com</code> for staging and <code>data.mywebapp.com</code> for production
      </>
    ),
    //    columns: [{ title: "name", render: (c: StreamConfig) => c.name }],
  };
  return (
    <>
      {implementationDocumentationId && (
        <TrackingIntegrationDocumentation
          streamId={implementationDocumentationId}
          onCancel={() => {
            setImplementationDocumentationId(undefined);
            router.push(
              { pathname: router.pathname, query: omit(router.query, "implementationFor", "framework") },
              undefined,
              {
                shallow: true,
              }
            );
          }}
        />
      )}
      <ConfigEditor {...(config as any)} />
    </>
  );
};

export default Streams;
