import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { ConfigEditor, ConfigEditorProps, CustomCheckbox } from "../../components/ConfigObjectEditor/ConfigEditor";
import { StreamConfig } from "../../lib/schema";
import { useAppConfig, useWorkspace } from "../../lib/context";
import React, { useState } from "react";
import Link from "next/link";
import { FaExternalLinkAlt } from "react-icons/fa";
import { branding } from "../../lib/branding";
import { useRouter } from "next/router";
import { TrackingIntegrationDocumentation } from "../../components/TrackingIntegrationDocumentation/TrackingIntegrationDocumentation";
import { StreamKeysEditor } from "../../components/ApiKeyEditor/ApiKeyEditor";
import { Activity, AlertTriangle, Check, Wrench, Zap } from "lucide-react";
import { FaviconLoader } from "./index";
import { ObjectTitle } from "../../components/ObjectTitle/ObjectTitle";
import omit from "lodash/omit";
import { toURL } from "../../lib/shared/url";
import JSON5 from "json5";
import { EditorToolbar } from "../../components/EditorToolbar/EditorToolbar";
import { useConfigObjectLinks, useConfigObjectList } from "../../lib/store";
import { DomainsEditor } from "../../components/DomainsEditor/DomainsEditor";

const Streams: React.FC<any> = () => {
  return (
    <WorkspacePageLayout>
      <StreamsList />
    </WorkspacePageLayout>
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

  const workspaceDomains = useConfigObjectList("domain").map(d => d.name);
  const staticDomains = workspaceDomains.filter(d => !d.includes("*"));
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
                  {[
                    `${s.id}.${appConfig.publicEndpoints.dataHost}`,
                    ...new Set([...staticDomains, ...(s.domains ?? [])]),
                  ].map(domain => (
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
        editor: StreamKeysEditor,
        displayName: "Server-to-server Write Keys",
        advanced: false,
        documentation: (
          <>Those keys should be kept in private and used only for server-to-server calls, such as HTTP Event API</>
        ),
      },
      publicKeys: {
        editor: StreamKeysEditor,
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
        editor: (props: any) => <DomainsEditor workspaceDomains={workspaceDomains} context={"site"} {...props} />,
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
