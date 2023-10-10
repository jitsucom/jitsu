import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { DestinationConfig, ServiceConfig, StreamConfig } from "../../lib/schema";
import { branding } from "../../lib/branding";
import { Badge, Steps, Tooltip } from "antd";
import { WLink } from "../../components/Workspace/WLink";
import React, { ReactNode, useEffect, useState } from "react";
import { FaGlobe } from "react-icons/fa";
import { LabelEllipsis } from "../../components/LabelEllipsis/LabelEllipsis";
import { coreDestinationsMap } from "../../lib/schema/destinations";
import { useTitle } from "../../lib/ui";
import { z } from "zod";
import { ConfigurationObjectLinkDbModel } from "../../prisma/schema";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { ProvisionDatabaseButton } from "../../components/ProvisionDatabaseButton/ProvisionDatabaseButton";
import { ConnectionsDiagram } from "../../components/ConnectionsDiagram/ConnectionsDiagram";
import { getLog } from "juava";
import { Chrome } from "lucide-react";
import classNames from "classnames";
import { useRouter } from "next/router";
import { TrackingIntegrationDocumentation } from "../../components/TrackingIntegrationDocumentation/TrackingIntegrationDocumentation";
import omit from "lodash/omit";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get, getConfigApi } from "../../lib/useApi";
import { LoadingAnimation } from "../../components/GlobalLoader/GlobalLoader";
import { GlobalError } from "../../components/GlobalError/GlobalError";

function Welcome({
  destinations,
  streams,
  links,
}: {
  streams: StreamConfig[];
  destinations: DestinationConfig[];
  links: any[];
}) {
  const router = useRouter();
  const [implementationDocumentationId, setImplementationDocumentationId] = useState<string | undefined>(
    router.query.implementationFor as string | undefined
  );

  let step = -1;
  if (streams.length > 0 && destinations.length > 0 && links.length > 0) {
    step = 3;
  } else if (streams.length > 0 && destinations.length > 0) {
    step = 2;
  } else if (streams.length > 0) {
    step = 1;
  } else {
    step = 0;
  }
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
      <div className="flex flex-col items-center">
        <h1 className="text-center text-4xl mt-6">✨ Welcome to {branding.productName}!</h1>
        <div className="text-2xl text-textLight mb-10 mt-6">Implement {branding.productName} in 4 simple steps</div>
        <div>
          <Steps direction="vertical" current={step}>
            <Steps.Step
              title={
                <>
                  Add your website or application
                  {streams.length > 0 ? (
                    <>
                      {" "}
                      - <b>done</b>!
                    </>
                  ) : (
                    ""
                  )}
                </>
              }
              description={
                streams.length === 0 ? (
                  <>
                    <WLink href={`/streams?id=new&backTo=%2F%3Fwelcome%3D1`}>Click here to add it!</WLink>
                  </>
                ) : (
                  <>
                    Congratulations! You have{" "}
                    <WLink href={`/streams`} passHref>
                      {streams.length} {streams.length > 1 ? "sites" : "site"}
                    </WLink>{" "}
                    configured.
                  </>
                )
              }
            />
            <Steps.Step
              title={
                <>
                  Add the destination of your data{" "}
                  {destinations.length > 0 ? (
                    <>
                      {" "}
                      - <b>done</b>!
                    </>
                  ) : (
                    ""
                  )}
                </>
              }
              description={
                destinations.length === 0 ? (
                  <>
                    <WLink href={`/destinations?showCatalog=true&backTo=%2F%3Fwelcome%3D1`}>
                      Click here to add it!
                    </WLink>
                  </>
                ) : (
                  <>
                    Congratulations! You have{" "}
                    <WLink href={`/destinations`} passHref>
                      {destinations.length} {destinations.length > 1 ? "destinations" : "destination"}
                    </WLink>{" "}
                    configured.
                  </>
                )
              }
            />
            <Steps.Step
              title={
                <>
                  Link your site with destination{" "}
                  {links.length > 0 ? (
                    <>
                      {" "}
                      - <b>done</b>!
                    </>
                  ) : (
                    ""
                  )}
                </>
              }
              description={
                links.length === 0 ? (
                  streams.length > 0 && destinations.length > 0 ? (
                    <>
                      <WLink href={`/connections/edit?backTo=%2F%3Fwelcome%3D1`}>Click here to add it!</WLink>
                    </>
                  ) : (
                    <>First, add at least one site and destination</>
                  )
                ) : (
                  <>
                    Congratulations! You have{" "}
                    <WLink href={`/connections`} passHref>
                      {links.length} {links.length > 1 ? "connections" : "connection"}
                    </WLink>{" "}
                    configured.
                  </>
                )
              }
            />
            <Steps.Step
              title="Start capturing data"
              description={
                streams.length === 0 ? (
                  <>
                    First, <WLink href={`/streams?id=new&backTo=%2F%3Fwelcome%3D1`}>add at least one site</WLink>
                  </>
                ) : (
                  <>
                    Read{" "}
                    <Link href={"#"} onClick={() => setImplementationDocumentationId(streams[0].id)}>
                      {branding.productName} implementation documentation
                    </Link>
                  </>
                )
              }
            />
          </Steps>
        </div>
      </div>
    </>
  );
}

function HoverBorder({ children, forceHover }: { children: ReactNode; forceHover?: boolean }) {
  const [_hover, setHover] = useState(false);
  const hover = forceHover || _hover;
  return (
    <div
      className={classNames(
        "border border-transparent transition duration-150 rounded-lg",
        hover ? "border-primary" : "border-primaryLighter"
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={hover ? { padding: "0px", borderWidth: "3px" } : { padding: "2px", borderWidth: "1px" }}
    >
      {children}
    </div>
  );
}

function Card({
  title,
  configLink,
  icon,
  selected,
}: {
  title: string;
  configLink?: string;
  icon: ReactNode;
  selected?: boolean;
}) {
  const card = (
    <HoverBorder forceHover={selected}>
      <div className={classNames(`w-full px-4 py-5 rounded-lg text-primary`)}>
        <div className="flex flex-start items-center space-x-4">
          <div className="w-6 h-6">{icon}</div>
          <div className="text-lg py-0 text-neutral-600">
            <LabelEllipsis maxLen={29}>{title}</LabelEllipsis>
          </div>
        </div>
      </div>
    </HoverBorder>
  );
  return configLink ? <a href={configLink}>{card}</a> : card;
}

type ConfigurationLinkDbModel = Omit<z.infer<typeof ConfigurationObjectLinkDbModel>, "data">;

function DestinationCard({ dest, selected }: { dest: DestinationConfig; selected?: boolean }) {
  const workspace = useWorkspace();
  const card = (
    <Card
      selected={selected}
      icon={coreDestinationsMap[dest.destinationType]?.icon || <FaGlobe className="w-full h-full" />}
      title={dest.name}
      configLink={!dest.provisioned ? `/${workspace.id}/destinations?id=${dest.id}` : `/${workspace.id}/destinations`}
    />
  );
  return (
    <div className="" key={dest.id}>
      {dest.provisioned ? (
        <Badge.Ribbon
          text={
            <>
              <Tooltip
                title={
                  <>
                    This destination is <b>provisioned</b>. It's hosted and managed by Jitsu, so you can't edit
                    connection details. But you can use it as destination and query the data
                  </>
                }
              >
                Provisioned <QuestionCircleOutlined />
              </Tooltip>
            </>
          }
        >
          {card}
        </Badge.Ribbon>
      ) : (
        card
      )}
    </div>
  );
}

export const FaviconLoader: React.FC<{ potentialUrl?: string }> = ({ potentialUrl }) => {
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (potentialUrl) {
        let url;
        let fullUrl =
          potentialUrl.indexOf("http") === 0 ? potentialUrl + "/favicon.ico" : `https://${potentialUrl}/favicon.ico`;
        try {
          url = new URL(fullUrl);
        } catch (e) {
          getLog().atDebug().withCause(e).log(`Failed to parse url ${fullUrl}`);
        }
        let response;
        try {
          response = await fetch(fullUrl);
        } catch (e) {
          getLog().atDebug().withCause(e).log(`Failed to parse url ${fullUrl}`);
          return;
        }
        if (response.ok) {
          setFaviconUrl(fullUrl);
        } else {
          getLog().atDebug().log(`Failed to load favicon for ${fullUrl}`);
        }
      }
    })();
  }, [potentialUrl]);
  return faviconUrl ? (
    <img alt={""} src={faviconUrl} className="w-full h-full" />
  ) : (
    <Chrome className="w-full h-full text-blue-600" />
  );
};

function WorkspaceOverview(props: {
  streams: StreamConfig[];
  destinations: DestinationConfig[];
  connectors: ServiceConfig[];
  links: ConfigurationLinkDbModel[];
}) {
  const router = useRouter();
  const appConfig = useAppConfig();
  const workspace = useWorkspace();
  const { destinations, streams, links, connectors } = props;
  useTitle(`${branding.productName} : ${workspace.name}`);
  const configurationFinished =
    !router.query.welcome && streams.length > 0 && destinations.length > 0 && links.length > 0;
  return (
    <div>
      {!configurationFinished && <Welcome streams={streams} destinations={destinations} links={links} />}
      {configurationFinished && (
        <ConnectionsDiagram
          connectorSourcesActions={{
            title: "Connectors",
            newLink: `/${workspace.slugOrId}/services?showCatalog=true`,
            editLink: `/${workspace.slugOrId}/services`,
          }}
          connectorSources={connectors.map(({ id, name, ...cfg }) => ({
            id,
            card: (forceSelect: boolean) => (
              <Card
                selected={forceSelect}
                icon={<img alt="logo" src={`/api/sources/logo?package=${cfg.package}&protocol=${cfg.protocol}`} />}
                title={name || id}
                configLink={`/${workspace.id}/services?id=${id}`}
              />
            ),
          }))}
          srcActions={{
            title: "Sites",
            newLink: `/${workspace.slugOrId}/streams?id=new`,
            editLink: `/${workspace.slugOrId}/streams`,
          }}
          dstActions={{
            title: "Destinations",
            newLink: `/${workspace.slugOrId}/destinations?showCatalog=true`,
            editLink: `/${workspace.slugOrId}/destinations`,
          }}
          sources={streams.map(({ id, name }) => ({
            id: id,
            card: (forceSelect: boolean) => (
              <Card
                selected={forceSelect}
                icon={<FaviconLoader potentialUrl={name} />}
                title={name || id}
                configLink={`/${workspace.id}/streams?id=${id}`}
              />
            ),
          }))}
          destinations={destinations.map(d => ({
            id: d.id,
            card: (forceSelect: boolean) => <DestinationCard selected={forceSelect} dest={d} />,
          }))}
          connections={links.map(l => ({
            from: l.fromId,
            to: l.toId,
          }))}
        />
      )}
      {configurationFinished && appConfig.ee?.available && (
        <div className="flex justify-center">
          <ProvisionDatabaseButton />
        </div>
      )}
    </div>
  );
}

function WorkspaceOverviewLoader() {
  const workspace = useWorkspace();
  const dataLoader = useQuery(
    ["workspaceEntities", workspace.id],
    () => {
      return Promise.all([
        getConfigApi(workspace.id, "stream").list(),
        getConfigApi(workspace.id, "destination").list(),
        get(`/api/${workspace.id}/config/link`).then(r => r.links),
        getConfigApi(workspace.id, "service").list(),
      ]);
    },
    { retry: false, cacheTime: 0 }
  );
  if (dataLoader.isLoading) {
    return <LoadingAnimation />;
  } else if (dataLoader.error) {
    return <GlobalError title={"Failed to load data from server"} error={dataLoader.error} />;
  }
  console.log("Data", dataLoader.data);
  const [streams, destinations, links, services] = dataLoader.data!;
  return <WorkspaceOverview streams={streams} destinations={destinations} links={links} connectors={services} />;
}

const WorkspaceOverviewPage = () => {
  return (
    <WorkspacePageLayout>
      <WorkspaceOverviewLoader />
    </WorkspacePageLayout>
  );
};
export default WorkspaceOverviewPage;
