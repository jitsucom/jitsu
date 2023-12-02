import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import { get } from "../../../lib/useApi";
import { DestinationConfig, FunctionConfig, StreamConfig } from "../../../lib/schema";
import { ConfigurationObjectLinkDbModel } from "../../../prisma/schema";
import { QueryResponse } from "../../../components/QueryResponse/QueryResponse";
import { z } from "zod";
import { Table } from "antd";
import { confirmOp, feedbackError, feedbackSuccess } from "../../../lib/ui";
import React, { useState } from "react";
import Link from "next/link";
import { FaExternalLinkAlt, FaPlus, FaTrash } from "react-icons/fa";
import { index } from "juava";
import { getCoreDestinationType } from "../../../lib/schema/destinations";
import { useRouter } from "next/router";
import { useLinksQuery } from "../../../lib/queries";
import { jsonSerializationBase64, useQueryStringState } from "../../../lib/useQueryStringState";
import { TableProps } from "antd/es/table/InternalTable";
import { ColumnType, SortOrder } from "antd/es/table/interface";
import { Activity, Edit3, Inbox, XCircle } from "lucide-react";
import { PlusOutlined } from "@ant-design/icons";
import { WJitsuButton } from "../../../components/JitsuButton/JitsuButton";
import { DestinationTitle } from "../destinations";
import { ButtonGroup, ButtonProps } from "../../../components/ButtonGroup/ButtonGroup";
import { StreamTitle } from "../streams";
import { FunctionTitle } from "../functions";
import omit from "lodash/omit";
import { toURL } from "../../../lib/shared/url";
import JSON5 from "json5";

function EmptyLinks() {
  const workspace = useWorkspace();
  return (
    <div>
      <div className="flex flex-col items-center">
        <div className="text-xl text-textLight mb-3">
          {" "}
          You don't have any links between <Link href={`/${workspace.id}/sites`}>sites</Link> and{" "}
          <Link href={`/${workspace.id}/destinations`}>destinations</Link>
        </div>

        <WJitsuButton href={`/connections/edit`} type="link">
          <span className="text-lg">Create your first connection</span>
        </WJitsuButton>
      </div>
    </div>
  );
}

export const ConnectionTitle: React.FC<{
  connectionId: string;
  stream: StreamConfig;
  destination: DestinationConfig;
  showLink?: boolean;
}> = ({ connectionId, stream, destination, showLink = false }) => {
  return (
    <div className={"flex flex-row whitespace-nowrap gap-1.5"}>
      <StreamTitle size={"small"} stream={stream} />
      {"→"}
      <DestinationTitle size={"small"} destination={destination} />
      {showLink && (
        <WJitsuButton
          href={`/connection/edit?id=${connectionId}`}
          type="link"
          className="link"
          size="small"
          icon={<FaExternalLinkAlt className="w-2.5 h-2.5" />}
        />
      )}
    </div>
  );
};

type ConfigurationLinkDbModel = z.infer<typeof ConfigurationObjectLinkDbModel>;

type RemoteEntitiesProps = {
  streams: StreamConfig[];
  destinations: DestinationConfig[];
  links: Omit<ConfigurationLinkDbModel, "data">[];
  functions: FunctionConfig[];
  reloadCallback: () => void;
};

type SortingSettings = {
  columns: { order: SortOrder; field: string }[];
};

function ConnectionsTable({ links, streams, destinations, functions, reloadCallback }: RemoteEntitiesProps) {
  const streamsById = index(streams, "id");
  const destinationsById = index(destinations, "id");
  const functionsById = index(functions, "id");

  const workspace = useWorkspace();
  const router = useRouter();
  const [showId, setShowId] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [sorting, setSorting] = useQueryStringState<SortingSettings>("sorting", {
    defaultValue: { columns: [] },
    ...jsonSerializationBase64,
  });
  const deleteConnection = async (link: Omit<ConfigurationLinkDbModel, "data">) => {
    if (await confirmOp("Are you sure you want to unlink this site from this destination?")) {
      setLoading(true);
      try {
        await get(`/api/${workspace.id}/config/link`, {
          method: "DELETE",
          query: { fromId: link.fromId, toId: link.toId },
        });
        feedbackSuccess("Successfully unliked");
        reloadCallback();
      } catch (e) {
        feedbackError("Failed to unlink site and destination", { error: e });
      } finally {
        setLoading(false);
      }
    }
  };
  const onChange: TableProps<any>["onChange"] = (pagination, filters, sorter, { currentDataSource }) => {
    const sortArray = Array.isArray(sorter) ? sorter : [sorter];
    const columns = sortArray
      .filter(s => !!s.column?.title && !!s.order)
      .map(s => ({ field: s.column?.title, order: s.order }));
    const newVal = {
      columns: columns as any,
    };
    setSorting(newVal);
    console.log("sorter", newVal);
  };
  const columns: ColumnType<any>[] = [
    {
      title: "ID",
      dataIndex: "id",
      width: "33%",
      className: showId ? "" : "hidden",
      render: (text, link) => {
        return <div className="flex items-center text-text text-xs whitespace-nowrap">{link.id}</div>;
      },
    },
    {
      title: "Source",
      width: "33%",
      sortOrder: sorting.columns?.find(s => s.field === "Source")?.order,
      sorter: (a, b) => {
        const streamA = streamsById[a.fromId];
        const streamB = streamsById[b.fromId];
        return (streamA.name || "").localeCompare(streamB.name || "");
      },
      render: (text, link) => {
        const stream = streamsById[link.fromId];
        if (!stream) {
          return <div>Stream not found</div>;
        }
        return (
          <div className="flex items-center">
            <StreamTitle stream={stream} link />
          </div>
        );
      },
    },
    {
      title: "Destination",
      width: "33%",
      sortOrder: sorting.columns?.find(s => s.field === "Destination")?.order,

      sorter: (a, b) => {
        const destA = destinationsById[a.toId];
        const destB = destinationsById[b.toId];
        return (destA.name || "").localeCompare(destB.name || "");
      },
      render: (text, link) => {
        const destination = destinationsById[link.toId];
        if (!destination) {
          return <div>Destination not found</div>;
        }
        return (
          <div className="flex items-center">
            <DestinationTitle destination={destination} link />
          </div>
        );
      },
    },
    {
      title: "Functions",
      width: "33%",
      render: (text, link) => {
        return (
          <div className="flex flex-row flex-wrap items-center gap-1 gap-x-2.5">
            {functions &&
              (link.data?.functions || [])
                .filter(f => f.functionId.startsWith("udf."))
                .map((f, i) => {
                  const id = f.functionId.replace("udf.", "");
                  const func = functionsById[id];
                  if (!func) {
                    return <FunctionTitle size={"small"} key={i} title={() => f.functionId} />;
                  }
                  return (
                    <div
                      className="cursor-pointer"
                      onClick={e => router.push(`/${workspace.id}/functions?id=${id}`)}
                      key={i}
                    >
                      <FunctionTitle size={"small"} f={func} />
                    </div>
                  );
                })}
          </div>
        );
      },
    },
    {
      title: <span onClick={() => setShowId(!showId)}>Actions</span>,
      key: "actions",
      render: (text, link) => {
        const dst = destinationsById[link.toId];
        let type = "functions";
        try {
          if (getCoreDestinationType(dst.destinationType).usesBulker) {
            type = "bulker";
          }
        } catch (e) {}
        const items: ButtonProps[] = [
          {
            icon: <Edit3 className={"w-4 h-4"} />,
            label: "Edit",
            href: `/connections/edit?id=${link.id}`,
          },
          {
            icon: <Activity className="w-4 h-4" />,
            //collapsed: true,
            href: toURL("/data", {
              query: JSON5.stringify({
                activeView: type,
                viewState: { [type]: { actorId: link.id } },
              }),
            }),
            label: "Live Events",
          },
          {
            icon: <FaTrash />,
            collapsed: true,
            onClick: async () => {
              deleteConnection(link);
            },
            danger: true,
            label: "Delete",
          },
        ];
        return <ButtonGroup items={items} />;
      },
    },
  ];
  return (
    <div>
      <Table
        rowKey={"id"}
        dataSource={links}
        sortDirections={["ascend", "descend"]}
        columns={columns}
        className="border border-backgroundDark rounded-lg"
        pagination={false}
        loading={loading}
        onChange={onChange}
      />
    </div>
  );
}

function Connections(props: RemoteEntitiesProps) {
  const { streams, destinations, links, functions } = props;
  const router = useRouter();
  const destinationFilter = router.query.destination as string | undefined;
  const srcFilter = router.query.source as string | undefined;
  const workspace = useWorkspace();
  if (props.streams.length == 0 || props.destinations.length == 0) {
    return (
      <div className="flex flex-col justify-center items-center ">
        <Inbox className="w-16 h-16 text-textDisabled" />
        <div className="text-center mt-12 text text-textLight max-w-4xl">
          In order to connect site to destination please create at least one destination and one stream. Currently, you
          have{" "}
          <Link href={`/${workspace.slug || workspace.id}/destinations`} className="underline">
            {props.destinations.length} destination{props.destinations.length === 1 ? "" : "s"}
          </Link>{" "}
          and{" "}
          <Link href={`/${workspace.slug || workspace.id}/streams`} className="underline">
            {props.streams.length} site{props.streams.length === 1 ? "" : "s"}
          </Link>{" "}
          configured
        </div>
        <div className="flex space-x-4 items-center mt-4">
          <WJitsuButton href={"/destinations"} type="default" icon={<PlusOutlined />}>
            Create Destination
          </WJitsuButton>
          <WJitsuButton href={"/streams"} type="default" icon={<PlusOutlined />}>
            Create Site
          </WJitsuButton>
        </div>
      </div>
    );
  }
  console.log("router.query", router);
  return (
    <div>
      <div className="flex justify-between py-6">
        <div className="flex items-center">
          <div className="text-3xl">Edit connections</div>
          {destinationFilter && (
            <div className="mt-1 ml-4 rounded-full bg-textDisabled/50 px-4 py-1 flex flex-nowrap items-center">
              {/*<span className="mr-2 ">to</span>*/}
              <DestinationTitle size="small" destination={destinations.find(d => d.id === destinationFilter)} />
              <Link className={"ml-1"} prefetch={false} href={toURL(router.route, omit(router.query, ["destination"]))}>
                <XCircle className="w-4 h-4 text-textLight" />
              </Link>
            </div>
          )}
          {srcFilter && (
            <div className="mt-1 ml-4 rounded-full bg-textDisabled/50 px-4 py-1 flex flex-nowrap items-center">
              {/*<span className="mr-2 ">to</span>*/}
              <StreamTitle size="small" stream={streams.find(d => d.id === srcFilter)} />
              <Link className={"ml-1"} prefetch={false} href={toURL(router.route, omit(router.query, ["source"]))}>
                <XCircle className="w-4 h-4 text-textLight" />
              </Link>
            </div>
          )}
        </div>
        <div>
          <WJitsuButton href={`/connections/edit`} type="primary" size="large" icon={<FaPlus className="anticon" />}>
            Connect site and destination
          </WJitsuButton>
        </div>
      </div>
      <div>
        {links.length === 0 && <EmptyLinks />}
        {links.length > 0 && (
          <ConnectionsTable
            links={links
              .filter(l => !destinationFilter || l.toId === destinationFilter)
              .filter(l => !srcFilter || l.fromId === srcFilter)}
            functions={functions}
            streams={streams}
            destinations={destinations}
            reloadCallback={props.reloadCallback}
          />
        )}
      </div>
    </div>
  );
}

function ConnectionsLoader(props: { reloadCallback: () => void }) {
  const workspace = useWorkspace();
  const data = useLinksQuery(workspace.id, "push", {
    cacheTime: 0,
    retry: false,
    withFunctions: true,
  });

  return (
    <QueryResponse
      result={data}
      render={([streams, destinations, links, functions]) => (
        <Connections
          functions={functions}
          streams={streams}
          destinations={destinations}
          links={links}
          reloadCallback={props.reloadCallback}
        />
      )}
    />
  );
}

const ConnectionsPage = () => {
  const [refresh, setRefresh] = useState(new Date());
  return (
    <WorkspacePageLayout>
      <ConnectionsLoader
        key={refresh.toISOString()}
        reloadCallback={() => {
          setRefresh(new Date());
        }}
      />
    </WorkspacePageLayout>
  );
};
export default ConnectionsPage;
