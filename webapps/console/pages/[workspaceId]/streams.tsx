import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { Button, Input, notification, Tag, Tooltip } from "antd";
import { ConfigEditor, ConfigEditorProps } from "../../components/ConfigObjectEditor/ConfigEditor";
import { StreamConfig } from "../../lib/schema";
import { useAppConfig, useWorkspace } from "../../lib/context";
import React, { PropsWithChildren, useMemo, useState } from "react";
import Link from "next/link";
import { FaExternalLinkAlt, FaSpinner, FaTrash, FaWrench } from "react-icons/fa";
import { branding } from "../../lib/branding";
import { useRouter } from "next/router";
import { TrackingIntegrationDocumentation } from "../../components/TrackingIntegrationDocumentation/TrackingIntegrationDocumentation";
import { ApiKeysEditor } from "../../components/ApiKeyEditor/ApiKeyEditor";
import { useQuery } from "@tanstack/react-query";
import { getEeClient } from "../../lib/ee-client";
import { requireDefined } from "juava";
import { ReloadOutlined } from "@ant-design/icons";
import { confirmOp, feedbackError } from "../../lib/ui";
import type { DomainStatus } from "../../lib/server/ee";
import { getAntdModal, useAntdModal } from "../../lib/modal";
import { get } from "../../lib/useApi";
import { FaviconLoader } from "./index";
import { ObjectTitle } from "../../components/ObjectTitle/ObjectTitle";
import omit from "lodash/omit";
import { CustomWidgetProps } from "../../components/ConfigObjectEditor/Editors";
import LucideIcon from "../../components/Icons/LucideIcon";

const Streams: React.FC<any> = () => {
  return (
    <WorkspacePageLayout>
      <StreamsList />
    </WorkspacePageLayout>
  );
};

const StatusBadge: React.FC<
  PropsWithChildren<{ status: "error" | "warning" | "success" | "loading"; className?: string }>
> = ({ status, children, className }) => {
  let color: string | undefined;
  let defaultDescription: string;
  if (status === "error") {
    color = "red";
    defaultDescription = "Error";
  } else if (status === "success") {
    color = "cyan";
    defaultDescription = "Success";
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
  const { data, isLoading, error, refetch } = useQuery<DomainStatus>(
    ["domain-status", domain.toLowerCase(), reloadTrigger],
    async () => {
      return await eeClient.attachDomain(domain);
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
            <LucideIcon
              name={"globe"}
              className={`w-full h-full ${
                error || data?.error ? "text-red-600" : data?.needsConfiguration ? "text-yellow-600" : "text-blue-600"
              }`}
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
            {data?.needsConfiguration && (
              <Tooltip title="See configuration instructions">
                <Button
                  type="text"
                  danger
                  disabled={isLoading || deleting}
                  onClick={() => {
                    DomainConfigurationInstructions.show({ domain, status: data });
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
            } else if (error || data?.error) {
              return <StatusBadge status="error">ERROR</StatusBadge>;
            } else if (data?.needsConfiguration) {
              return <StatusBadge status="warning">Configuration Required</StatusBadge>;
            } else {
              return <StatusBadge status="success">OK</StatusBadge>;
            }
          })()}
        </div>
        {(error || data?.error) && (
          <div className="flex items-start mt-1">
            <div className={"mr-2"}>Description:</div>
            <div className="">{`${data?.error || "Internal error"}`}</div>
          </div>
        )}
        {data?.needsConfiguration && (
          <div className="flex items-start mt-1">
            <div className={"mr-2"}>Description:</div>
            <div className="">
              See{" "}
              <a
                className={"cursor-pointer"}
                onClick={() => DomainConfigurationInstructions.show({ domain, status: data })}
              >
                <u>configuration instructions</u>
              </a>
            </div>
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

export type DomainInstructionsProps = { domain: string; status: DomainStatus };
const DomainConfigurationInstructions: React.FC<DomainInstructionsProps> & {
  show: (p: DomainInstructionsProps) => void;
} = ({ domain, status }) => {
  if (status.needsConfiguration && status.configurationType === "cname") {
    return (
      <div>
        <h3>Set the following record on your DNS provider to continue</h3>
        <p className="bg-bgLight py-2 my-4">
          <DNSRecordTable records={[{ type: "CNAME", domain, value: status.cnameValue }]} />
        </p>
      </div>
    );
  } else if (status.needsConfiguration && status.configurationType == "verification") {
    return (
      <div>
        <h3>Set the following record on your DNS provider to continue</h3>
        <p className="bg-bgLight py-2 my-4">
          <DNSRecordTable records={status.verification} />
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
      const { available } = await get(`/api/${workspace.id}/domain-check?domain=${addValue}`);
      if (!available) {
        feedbackError(`Domain ${addValue} is not available. It is used by other workspace`);
        return;
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
}> = ({ stream, title = s => s.name, size = "default" }) => {
  return (
    <ObjectTitle
      icon={<FaviconLoader potentialUrl={stream?.name} />}
      size={size}
      title={stream ? title(stream) : "Unknown stream"}
    />
  );
};

const StreamsList: React.FC<{}> = () => {
  const workspace = useWorkspace();
  const noun = "site";
  const router = useRouter();
  const appConfig = useAppConfig();

  const [implementationDocumentationId, setImplementationDocumentationId] = useState<string | undefined>(
    router.query.implementationFor as string | undefined
  );
  const config: ConfigEditorProps<StreamConfig> = {
    subtitle: (obj, isNew) =>
      !isNew && (
        <Link
          href={`/${workspace.slug || workspace.id}/streams?id=${obj.id}&implementationFor=${obj.id}`}
          onClick={() => {
            router.replace(`/${workspace.slug || workspace.id}/streams?id=${obj.id}&implementationFor=${obj.id}`);
            setImplementationDocumentationId(obj.id);
          }}
          className="flex items-center space-x-2 text-primary"
        >
          <LucideIcon name={"wrench"} className="h-4 w-4" />
          <span>Setup Instructions</span>
        </Link>
      ),
    objectType: StreamConfig,
    icon: s => <FaviconLoader potentialUrl={s.name} />,
    actions: [
      {
        icon: <LucideIcon name={"wrench"} className="w-full h-full" />,
        title: "Setup Instructions",
        collapsed: false,
        action: stream => {
          router.replace({
            pathname: router.pathname,
            query: { ...(router.query || {}), implementationFor: stream.id },
          });
          setImplementationDocumentationId(stream.id);
        },
      },
    ],
    listColumns:
      appConfig.publicEndpoints.dataHost || appConfig.ee.available
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
        : [],
    fields: {
      type: { constant: "stream" },
      workspaceId: { constant: workspace.id },
      privateKeys: {
        editor: ApiKeysEditor,
        displayName: "Server-to-server Write Keys",
        advanced: false,
        documentation: (
          <>Those keys should be kept in private and used only for server-to-server calls, such as HTTP Event API</>
        ),
      },
      publicKeys: {
        editor: ApiKeysEditor,
        displayName: "Browser Write Keys",
        advanced: false,
        documentation: (
          <>
            Those keys are <strong>publicly accessible</strong>. They are used in client-side libraries, such as
            JavaScript. For additional security, consider limiting domains where those keys can be used by specifying{" "}
            <strong>Authorized JavaScript Domains</strong> below. <br />
            <br />
            Using public keys is not necessary, if you're using Custom Domains. In this case, {
              branding.productName
            }{" "}
            will authorize requests based on the domain name.
          </>
        ),
      },
      authorizedJavaScriptDomains: {
        displayName: "Authorized JavaScript Domains",
        documentation: (
          <>
            If this setting is not empty, JavaScript code from the specified domains will be able to post data to
            {noun}. Separate multiple domains by comma. Leave the field empty to allow any domain. If you want to allow
            top level domains, and all subdomains, use wildcard as in{" "}
            <code>*.mywebsite.com,mywebsite.com,localhost</code>. It makes sense to add <code>localhost</code>, at least
            for dev environments.
          </>
        ),
      },
      domains: {
        editor: DomainsEditor,
        hidden: !appConfig.ee.available,
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
