import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../lib/context";
import { DestinationConfig, StreamConfig } from "../../lib/schema";
import { QueryResponse } from "../../components/QueryResponse/QueryResponse";
import { branding } from "../../lib/branding";
import { Badge, Steps, Tooltip } from "antd";
import { WLink } from "../../components/Workspace/WLink";
import React, { ReactNode } from "react";
import { FaGlobe, FaPlus } from "react-icons/fa";
import { LabelEllipsis } from "../../components/LabelEllipsis/LabelEllipsis";
import { coreDestinationsMap } from "../../lib/schema/destinations";
import { PropsWithChildrenClassname, useTitle } from "../../lib/ui";
import { z } from "zod";
import { ConfigurationObjectLinkDbModel } from "../../prisma/schema";
import { useLinksQuery } from "../../lib/queries";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { ButtonProps } from "antd/es/button/button";
import { Simplify } from "type-fest";
import { ProvisionDatabaseButton } from "../../components/ProvisionDatabaseButton/ProvisionDatabaseButton";
import { JitsuButton } from "../../components/JitsuButton/JitsuButton";

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

function Card({ title, configLink, icon }: { title: string; configLink?: string; icon: ReactNode }) {
  const card = (
    <div className="w-72 p-3 rounded text-primary shadow transition duration-150 hover:shadow-md">
      <div className="flex flex-start space-x-4">
        <div className="w-6 h-6 mt-1">{icon}</div>
        <div className="text-lg  mb-4 py-0 text-neutral-600">
          <LabelEllipsis maxLen={20}>{title}</LabelEllipsis>
        </div>
      </div>
    </div>
  );
  return configLink ? <a href={configLink}>{card}</a> : card;
}

type ButtonAction = Simplify<Pick<ButtonProps, "href"> | Pick<ButtonProps, "onClick">>;

function Section({
  title,
  children,
  noun,
  className,
  addAction,
}: PropsWithChildrenClassname<{ title: string; noun: string; addAction: ButtonAction }>) {
  return (
    <div className={className}>
      <div className="text-2xl pb-4 border-b border-primaryLighter flex justify-between">
        <div>{title}</div>
        <div>
          <JitsuButton icon={<FaPlus />} type="primary" size="large" {...addAction}>
            Add {noun}
          </JitsuButton>
        </div>
      </div>
      <section>{children}</section>
    </div>
  );
}

type ConfigurationLinkDbModel = Omit<z.infer<typeof ConfigurationObjectLinkDbModel>, "data">;

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
      {configurationFinished && destinations.length && (
        <Section
          className="mt-12"
          title="My sites"
          noun="site"
          addAction={{ href: `/${workspace.slug}/streams?id=new` }}
        >
          <div className="flex flex-wrap">
            {streams.map(stream => (
              <div className="pr-4 py-4" key={stream.id}>
                <Card
                  icon={<FaGlobe className="w-full h-full" />}
                  title={stream.name || stream.id}
                  configLink={`/${workspace.id}/streams?id=${stream.id}`}
                />
              </div>
            ))}
          </div>
        </Section>
      )}
      {configurationFinished && (
        <Section
          title="My destinations"
          className="mt-16"
          noun="destination"
          addAction={{ href: `/${workspace.slug}/destinations?showCatalog=true` }}
        >
          <div className="flex flex-wrap">
            {destinations.map(dest => {
              const card = (
                <Card
                  icon={coreDestinationsMap[dest.destinationType]?.icon || <FaGlobe className="w-full h-full" />}
                  title={dest.name}
                  configLink={!dest.provisioned ? `/${workspace.id}/destinations?id=${dest.id}` : undefined}
                />
              );
              return (
                <div className="pr-4 py-4" key={dest.id}>
                  {dest.provisioned ? (
                    <Badge.Ribbon
                      text={
                        <>
                          <Tooltip
                            title={
                              <>
                                This destination is <b>provisioned</b>. It's hosted and managed by Jitsu, so you can't
                                edit connection details. But you can use it as destination and query the data
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
            })}
          </div>
        </Section>
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
