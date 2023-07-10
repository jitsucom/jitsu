import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../lib/context";
import { DestinationConfig, StreamConfig } from "../../lib/schema";
import { QueryResponse } from "../../components/QueryResponse/QueryResponse";
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
import { useLinksQuery } from "../../lib/queries";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { ProvisionDatabaseButton } from "../../components/ProvisionDatabaseButton/ProvisionDatabaseButton";
import { ConnectionsDiagram } from "../../components/ConnectionsDiagram/ConnectionsDiagram";
import { getLog } from "juava";
import { Chrome } from "lucide-react";
import classNames from "classnames";

function Welcome({
  destinations,
  streams,
}: {
  streams: StreamConfig[];
  destinations: DestinationConfig[];
  links: any[];
}) {
  let step = -1;
  if (streams.length > 0 && destinations.length > 0) {
    step = 2;
  } else if (streams.length > 0) {
    step = 1;
  }
  return (
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
                  <WLink href={`/streams?id=new`}>Click here to add it!</WLink>
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
                  <WLink href={`/destinations?showCatalog=true`}>Click here to add it!</WLink>
                </>
              ) : (
                <>
                  Congratulations! You have {destinations.length} destinations configured. You can always change{" "}
                  <WLink href={`/destinations`}>settings here</WLink>
                </>
              )
            }
          />
          <Steps.Step
            title="Link your site with destination"
            description={
              <WLink href={`/connections`} passHref>
                Edit site & destination connections
              </WLink>
            }
          />
          <Steps.Step
            title="Start capturing data"
            description={
              streams.length === 0 ? (
                <>
                  Fist, <WLink href={`/streams?id=new`}>add at list one site</WLink>
                </>
              ) : (
                <>
                  Read{" "}
                  <WLink href={`/streams?id=${streams[0].id}&implementationFor=${streams[0].id}`} passHref>
                    {branding.productName} implementation documentation
                  </WLink>
                </>
              )
            }
          />
        </Steps>
      </div>
    </div>
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
        <div className="flex flex-start space-x-4">
          <div className="w-6 h-6 mt-1">{icon}</div>
          <div className="text-lg py-0 text-neutral-600">
            <LabelEllipsis maxLen={20}>{title}</LabelEllipsis>
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
      configLink={!dest.provisioned ? `/${workspace.id}/destinations?id=${dest.id}` : undefined}
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

const FaviconLoader: React.FC<{ potentialUrl?: string }> = ({ potentialUrl }) => {
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
  return faviconUrl ? <img src={faviconUrl} className="w-full h-full" /> : <Chrome className="w-full h-full" />;
};

function WorkspaceOverview(props: {
  streams: StreamConfig[];
  destinations: DestinationConfig[];
  links: ConfigurationLinkDbModel[];
}) {
  const workspace = useWorkspace();
  const { destinations, streams, links } = props;
  useTitle(`${branding.productName} : ${workspace.name}`);
  const configurationFinished = streams.length > 0 && destinations.length > 0;
  return (
    <div>
      {!configurationFinished && <Welcome streams={streams} destinations={destinations} links={links} />}
      {configurationFinished && (
        <ConnectionsDiagram
          srcActions={{
            title: "Sites",
            newLink: `/${workspace.id}/streams?id=new`,
            editLink: `/${workspace.id}/streams`,
          }}
          dstActions={{
            title: "Destinations",
            newLink: `/${workspace.id}/destinations?id=new`,
            editLink: `/${workspace.id}/destinations`,
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
      {configurationFinished && (
        <div className="flex justify-center">
          <ProvisionDatabaseButton />
        </div>
      )}
    </div>
  );
}

function WorkspaceOverviewLoader() {
  const workspace = useWorkspace();
  const data = useLinksQuery(workspace.id, "push", {
    cacheTime: 0,
    retry: false,
  });
  return (
    <QueryResponse
      result={data}
      render={([streams, destinations, links]) => (
        <WorkspaceOverview streams={streams} destinations={destinations} links={links} />
      )}
      errorTitle="Failed to load data from server"
    />
  );
}

const WorkspaceOverviewPage = () => {
  return (
    <WorkspacePageLayout>
      <WorkspaceOverviewLoader />
    </WorkspacePageLayout>
  );
};
export default WorkspaceOverviewPage;
