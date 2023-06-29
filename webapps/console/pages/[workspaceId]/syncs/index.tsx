import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import { get } from "../../../lib/useApi";
import { DestinationConfig, ServiceConfig } from "../../../lib/schema";
import { ConfigurationObjectLinkDbModel } from "../../../prisma/schema";
import { QueryResponse } from "../../../components/QueryResponse/QueryResponse";
import { z } from "zod";
import { Dropdown, MenuProps, Table, Tag } from "antd";
import { confirmOp, feedbackError, feedbackSuccess } from "../../../lib/ui";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { FaExternalLinkAlt, FaPlus, FaRegPlayCircle, FaThList, FaTrash } from "react-icons/fa";
import { index, rpc } from "juava";
import { getCoreDestinationType } from "../../../lib/schema/destinations";
import { useRouter } from "next/router";
import { FiEdit2 } from "react-icons/fi";
import { useLinksQuery } from "../../../lib/queries";
import { jsonSerializationBase64, useQueryStringState } from "../../../lib/useQueryStringState";
import { TableProps } from "antd/es/table/InternalTable";
import { ColumnType, SortOrder } from "antd/es/table/interface";
import { Inbox } from "lucide-react";
import { PlusOutlined } from "@ant-design/icons";
import { JitsuButton, WJitsuButton } from "../../../components/JitsuButton/JitsuButton";
import { ErrorCard } from "../../../components/GlobalError/GlobalError";
import { Spinner } from "../../../components/GlobalLoader/GlobalLoader";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import { WLink } from "../../../components/Workspace/WLink";
import { ServiceTitle } from "../services";
import { DestinationTitle } from "../destinations";
import JSON5 from "json5";
dayjs.extend(utc);
dayjs.extend(relativeTime);

const formatDate = (date: string | Date) => dayjs(date, "YYYY-MM-DDTHH:mm:ss.SSSZ").utc().format("YYYY-MM-DD HH:mm:ss");

function EmptyLinks() {
  const workspace = useWorkspace();
  return (
    <div>
      <div className="flex flex-col items-center">
        <div className="text-xl text-textLight mb-3">
          {" "}
          You don't have any links between <Link href={`/${workspace.id}/services`}>services</Link> and{" "}
          <Link href={`/${workspace.id}/destinations`}>destinations</Link>
        </div>

        <WJitsuButton href={`/syncs/edit`} type="link">
          <span className="text-lg">Create your first sync</span>
        </WJitsuButton>
      </div>
    </div>
  );
}

type SyncDbModel = z.infer<typeof ConfigurationObjectLinkDbModel>;

type RemoteEntitiesProps = {
  services: ServiceConfig[];
  destinations: DestinationConfig[];
  links: Omit<SyncDbModel, "data">[];
  reloadCallback: () => void;
};

type SortingSettings = {
  columns: { order: SortOrder; field: string }[];
};

function SyncsTable({ links, services, destinations, reloadCallback }: RemoteEntitiesProps) {
  const servicesById = index(services, "id");
  const destinationsById = index(destinations, "id");
  const workspace = useWorkspace();
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [sorting, setSorting] = useQueryStringState<SortingSettings>("sorting", {
    defaultValue: { columns: [] },
    ...jsonSerializationBase64,
  });
  const [tasks, setTasks] = useState<{ loading: boolean; data?: any; error?: any }>({ loading: true });

  //useEffect update tasksData every 5 seconds
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const data = await rpc(`/api/${workspace.id}/sources/tasks`, { body: links.map(l => l.id) });
        setTasks({ loading: false, data });
      } catch (e) {
        setTasks({ loading: false, data: {}, error: e });
      }
    };
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, [links, workspace.id]);

  const deleteSync = async (link: Omit<SyncDbModel, "data">) => {
    if (await confirmOp("Are you sure you want to unlink this service from this destination?")) {
      setLoading(true);
      try {
        await get(`/api/${workspace.id}/config/link`, {
          method: "DELETE",
          query: { fromId: link.fromId, toId: link.toId },
        });
        feedbackSuccess("Successfully unliked");
        reloadCallback();
      } catch (e) {
        feedbackError("Failed to unlink service and destination", { error: e });
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
      title: "Service",
      width: "40%",
      sortOrder: sorting.columns?.find(s => s.field === "Service")?.order,
      sorter: (a, b) => {
        const serviceA = servicesById[a.fromId];
        const serviceB = servicesById[b.fromId];
        return (serviceA.name || "").localeCompare(serviceB.name || "");
      },
      render: (text, link) => {
        const service = servicesById[link.fromId];
        if (!service) {
          return <div>Service not found</div>;
        }
        return (
          <div className="flex items-center">
            <ServiceTitle service={service} />
            <WJitsuButton
              href={`/services?id=${link.fromId}`}
              type="link"
              className="link"
              size="small"
              icon={<FaExternalLinkAlt className="w-3 h-3" />}
            />
          </div>
        );
      },
    },
    {
      title: "Destination",
      width: "40%",
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
        const coreDestinationType = getCoreDestinationType(destination.destinationType);
        return (
          <div className="flex items-center">
            <DestinationTitle destination={destination} />
            <JitsuButton
              type="link"
              icon={<FaExternalLinkAlt className="w-3 h-3" />}
              className="link"
              size="small"
              href={`/${workspace.id}/destinations?id=${link.toId}`}
            />
          </div>
        );
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Sync Status</div>,
      width: "5%",
      render: (text, link) => {
        if (tasks.error) {
          return <div>error obtaining status</div>;
        }
        if (tasks.loading) {
          return (
            <div className="w-5 h-5">
              <Spinner />
            </div>
          );
        }
        const t = tasks.data.tasks?.[link.id];
        const color = (status: string) => {
          switch (status) {
            case "RUNNING":
              return "blue";
            case "FAILED":
              return "red";
            case "SUCCESS":
              return "green";
            default:
              return undefined;
          }
        };
        return <Tag color={t ? color(t.status) : undefined}>{t?.status ?? "NO RUNS"}</Tag>;
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Status Updated (UTC)</div>,
      width: "12%",
      render: (text, link) => {
        if (tasks.error || tasks.loading) {
          return undefined;
        }
        const t = tasks.data.tasks?.[link.id];
        return <div>{t ? formatDate(t.updatedAt) : ""}</div>;
      },
    },
    {
      title: "",
      render: (text, link) => {
        const items: MenuProps["items"] = [
          {
            label: "Run Sync",
            onClick: async () => {
              await rpc(`/api/${workspace.id}/sources/run?syncId=${link.id}`);
              router.push(
                `/${workspace.slug || workspace.id}/syncs/tasks?query=${encodeURIComponent(
                  JSON5.stringify({
                    syncId: link.id,
                    notification: "Sync Started",
                  })
                )}`
              );
            },
            key: "run",
            icon: <FaRegPlayCircle />,
          },
          {
            label: <WLink href={`/syncs/tasks?query=${JSON5.stringify({ syncId: link.id })}`}>Sync Logs</WLink>,
            key: "tasks",
            icon: <FaThList />,
          },
          {
            label: <WLink href={`/syncs/edit?id=${link.id}`}>Edit</WLink>,
            key: "edit",
            icon: <FiEdit2 />,
          },
          {
            label: "Delete",
            onClick: async () => {
              deleteSync(link);
            },
            key: "delete",
            icon: <FaTrash />,
          },
        ].filter(i => !!i);
        return (
          <div className="flex items-center justify-end">
            <Dropdown trigger={["click"]} menu={{ items }}>
              <div className="text-lg px-3 hover:bg-splitBorder cursor-pointer rounded-full text-center">⋮</div>
            </Dropdown>
          </div>
        );
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

function Syncs(props: RemoteEntitiesProps) {
  const { services, destinations, links } = props;
  const workspace = useWorkspace();
  if (props.services.length == 0 || props.destinations.length == 0) {
    return (
      <div className="flex flex-col justify-center items-center ">
        <Inbox className="w-16 h-16 text-textDisabled" />
        <div className="text-center mt-12 text text-textLight max-w-4xl">
          In order to connect service to destination please create at least one destination and one service. Currently,
          you have{" "}
          <Link href={`/${workspace.slug || workspace.id}/destinations`} className="underline">
            {props.destinations.length} destination{props.destinations.length === 1 ? "" : "s"}
          </Link>{" "}
          and{" "}
          <Link href={`/${workspace.slug || workspace.id}/services`} className="underline">
            {props.services.length} service{props.services.length === 1 ? "" : "s"}
          </Link>{" "}
          configured
        </div>
        <div className="flex space-x-4 items-center mt-4">
          <WJitsuButton href={"/destinations"} type="default" icon={<PlusOutlined />}>
            Create Destination
          </WJitsuButton>
          <WJitsuButton href={"/services"} type="default" icon={<PlusOutlined />}>
            Create Service
          </WJitsuButton>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex justify-between py-6">
        <div className="flex items-center">
          <div className="text-3xl">Edit syncs</div>
        </div>
        <div>
          <WJitsuButton href={`/syncs/edit`} type="primary" size="large" icon={<FaPlus className="anticon" />}>
            Connect service and destination
          </WJitsuButton>
        </div>
      </div>
      <div>
        {links.length === 0 && <EmptyLinks />}
        {links.length > 0 && (
          <SyncsTable
            links={links}
            services={services}
            destinations={destinations}
            reloadCallback={props.reloadCallback}
          />
        )}
      </div>
    </div>
  );
}

function SyncsLoader(props: { reloadCallback: () => void }) {
  const workspace = useWorkspace();
  const data = useLinksQuery(workspace.id, "sync", {
    cacheTime: 0,
    retry: false,
  });
  if (!workspace.featuresEnabled || !workspace.featuresEnabled.includes("syncs")) {
    return (
      <ErrorCard
        title={"Feature is not enabled"}
        error={{ message: "'Sources Sync' feature is not enabled for current project." }}
        hideActions={true}
      />
    );
  }

  return (
    <QueryResponse
      result={data}
      render={([services, destinations, links]) => (
        <Syncs services={services} destinations={destinations} links={links} reloadCallback={props.reloadCallback} />
      )}
    />
  );
}

const SyncsPage = () => {
  const [refresh, setRefresh] = useState(new Date());
  return (
    <WorkspacePageLayout>
      <SyncsLoader
        key={refresh.toISOString()}
        reloadCallback={() => {
          setRefresh(new Date());
        }}
      />
    </WorkspacePageLayout>
  );
};
export default SyncsPage;
