import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { DestinationConfig, ServiceConfig, StreamConfig } from "../../lib/schema";
import { branding } from "../../lib/branding";
import { Badge, Tooltip } from "antd";
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
import { Activity, Chrome, Edit3, MoreVertical, Share2, Zap } from "lucide-react";
import classNames from "classnames";
import { toURL } from "../../lib/shared/url";
import JSON5 from "json5";
import { ButtonGroup } from "../../components/ButtonGroup/ButtonGroup";
import { useConfigObjectLinks, useConfigObjectList } from "../../lib/store";
import Link from "next/link";

function HoverBorder({ children, forceHover }: { children: ReactNode; forceHover?: boolean }) {
  const [_hover, setHover] = useState(false);
  const hover = forceHover || _hover;
  return (
    <div
      className={classNames(
        "border border-transparent transition duration-150 rounded-lg w-full",
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

function ConditionalBadge({ icon, tooltip, children }: { icon?: ReactNode; tooltip?: ReactNode; children: ReactNode }) {
  if (!icon) {
    return <>{children}</>;
  }
  return (
    <Badge className="w-full block min-w-full" count={tooltip ? <Tooltip title={tooltip}>{icon}</Tooltip> : icon}>
      {children}
    </Badge>
  );
}

function Card({
  title,
  configLink,
  icon,
  selected,
  badge,
  actions,
}: {
  title: string;
  configLink?: string;
  icon: ReactNode;
  actions?: { label: ReactNode; icon?: ReactNode; href: string }[];
  selected?: boolean;
  badge?: {
    icon: ReactNode;
    tooltip?: ReactNode;
  };
}) {
  const card = (
    <ConditionalBadge icon={badge?.icon} tooltip={badge?.tooltip}>
      <HoverBorder forceHover={selected}>
        <div className={classNames(`w-full px-4 py-5 rounded-lg text-primary`)}>
          <div className="flex flex-nowrap justify-between items-start">
            <div className="flex flex-start items-center space-x-4">
              <div className="w-6 h-6">{icon}</div>
              <div className="text-lg py-0 text-neutral-600 text-ellipsis">
                <LabelEllipsis maxLen={29}>{title}</LabelEllipsis>
              </div>
            </div>
            {actions && actions.length > 0 && (
              <ButtonGroup
                dotsButtonProps={{
                  size: "small",
                  type: "ghost",
                  icon: <MoreVertical strokeWidth={2} className="text-textLight w-5 h-5" />,
                }}
                items={actions.map(a => ({ ...a, collapsed: true }))}
              />
            )}
          </div>
        </div>
      </HoverBorder>
    </ConditionalBadge>
  );
  return configLink ? <Link href={configLink}>{card}</Link> : card;
}

type ConfigurationLinkDbModel = Omit<z.infer<typeof ConfigurationObjectLinkDbModel>, "data">;

function DestinationCard({ dest, selected }: { dest: DestinationConfig; selected?: boolean }) {
  const workspace = useWorkspace();
  const card = (
    <Card
      selected={selected}
      icon={coreDestinationsMap[dest.destinationType]?.icon || <FaGlobe className="w-full h-full" />}
      title={dest.name}
      actions={
        dest.provisioned
          ? []
          : [
              { label: "Edit", href: `/destinations?id=${dest.id}`, icon: <Edit3 className="w-4 h-4" /> },

              {
                label: "View Connected Streams",
                icon: <Zap className="w-4 h-4" />,
                href: `/connections?sorting=${encodeURIComponent(
                  btoa(JSON.stringify({ columns: [{ field: "Source", order: "ascend" }] }))
                )}&destination=${encodeURIComponent(dest.id)}`,
              },
              {
                label: "View Syncs",
                icon: <Share2 className="w-4 h-4" />,
                href: `/syncs?destination=${encodeURIComponent(dest.id)}`,
              },
            ]
      }
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

function looksLikeUrl(potentialUrl: string) {
  try {
    new URL(potentialUrl);
    return true;
  } catch (e) {
    return false;
  }
}

export const FaviconLoader: React.FC<{ potentialUrl?: string }> = ({ potentialUrl }) => {
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (potentialUrl && looksLikeUrl(potentialUrl)) {
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
  const appConfig = useAppConfig();
  const workspace = useWorkspace();
  const { destinations, streams, links, connectors } = props;
  useTitle(`${branding.productName} : ${workspace.name}`);
  return (
    <div>
      {
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
                icon={
                  <img
                    alt="logo"
                    src={`/api/sources/logo?package=${encodeURIComponent(cfg.package)}&protocol=${cfg.protocol}`}
                  />
                }
                badge={
                  links?.find(l => l.fromId === id)
                    ? undefined
                    : {
                        icon: (
                          <div className="bg-warning w-5 h-5 rounded-full flex items-center justify-center font-bold text-text">
                            !
                          </div>
                        ),
                        tooltip:
                          "The source is not connected to any destination. Connect it to any destination to start seeing the data",
                      }
                }
                title={name || id}
                configLink={`/${workspace.slug || workspace.id}/services?id=${id}`}
                actions={[
                  { label: "Edit", href: `/services?id=${id}`, icon: <Edit3 className={"w-4 h-4"} /> },
                  {
                    label: "View Syncs",
                    icon: <Share2 className="w-4 h-4" />,
                    href: `/syncs?source=${encodeURIComponent(id)}`,
                  },
                ]}
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
                badge={
                  links.find(l => l.fromId === id)
                    ? undefined
                    : {
                        icon: (
                          <div className="bg-warning w-5 h-5 rounded-full flex items-center justify-center font-bold text-text">
                            !
                          </div>
                        ),
                        tooltip:
                          "The source is not connected to any destination. Connect it to any destination to start seeing the data",
                      }
                }
                configLink={`/${workspace.slug || workspace.id}/streams?id=${id}`}
                actions={[
                  { label: "Edit", href: `/streams?id=${id}`, icon: <Edit3 className={"w-4 h-4"} /> },
                  {
                    label: "Live Events",
                    icon: <Activity className="w-4 h-4" />,
                    href: toURL("/data", {
                      query: JSON5.stringify({
                        activeView: "incoming",
                        viewState: { incoming: { actorId: id } },
                      }),
                    }),
                  },
                  {
                    label: "View Connected Destinations",
                    icon: <Zap className="w-4 h-4" />,
                    href: `/connections?sorting=${encodeURIComponent(
                      btoa(JSON.stringify({ columns: [{ field: "Source", order: "ascend" }] }))
                    )}&source=${encodeURIComponent(id)}`,
                  },
                ]}
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
      }
      {appConfig.ee?.available && (
        <div className="flex justify-center">
          <ProvisionDatabaseButton />
        </div>
      )}
    </div>
  );
}

function WorkspaceOverviewLoader() {
  const streams = useConfigObjectList("stream");
  const destinations = useConfigObjectList("destination");
  const services = useConfigObjectList("service");
  const links = useConfigObjectLinks();

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
