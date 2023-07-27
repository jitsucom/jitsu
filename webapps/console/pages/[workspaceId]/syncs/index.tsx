import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useAppConfig, useWorkspace } from "../../../lib/context";
import { get } from "../../../lib/useApi";
import { DestinationConfig, ServiceConfig } from "../../../lib/schema";
import { ConfigurationObjectLinkDbModel } from "../../../prisma/schema";
import { QueryResponse } from "../../../components/QueryResponse/QueryResponse";
import { z } from "zod";
import { Alert, Table, Tag } from "antd";
import { confirmOp, feedbackError, feedbackSuccess } from "../../../lib/ui";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { FaExternalLinkAlt, FaPlay, FaPlus, FaTrash } from "react-icons/fa";
import { index, rpc } from "juava";
import { useRouter } from "next/router";
import { useLinksQuery } from "../../../lib/queries";
import { jsonSerializationBase64, useQueryStringState } from "../../../lib/useQueryStringState";
import { TableProps } from "antd/es/table/InternalTable";
import { ColumnType, SortOrder } from "antd/es/table/interface";
import { PlusOutlined } from "@ant-design/icons";
import { JitsuButton, WJitsuButton } from "../../../components/JitsuButton/JitsuButton";
import { ErrorCard } from "../../../components/GlobalError/GlobalError";
import { Spinner } from "../../../components/GlobalLoader/GlobalLoader";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import { ServiceTitle } from "../services";
import { DestinationTitle } from "../destinations";
import JSON5 from "json5";
import { ButtonGroup, ButtonProps } from "../../../components/ButtonGroup/ButtonGroup";
import { Overlay } from "../../../components/Overlay/Overlay";
import { CodeBlock } from "../../../components/CodeBlock/CodeBlock";
import JLucideIcon from "../../../components/Icons/JLucideIcon";
import RefreshCw from "../../../components/Icons/RefreshCw";

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
  const linksById = index(links, "id");
  const workspace = useWorkspace();
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [sorting, setSorting] = useQueryStringState<SortingSettings>("sorting", {
    defaultValue: { columns: [] },
    ...jsonSerializationBase64,
  });
  const [tasks, setTasks] = useState<{ loading: boolean; data?: any; error?: any }>({ loading: true });
  const [running, setRunning] = useState<string | undefined>(undefined);

  const [showScheduling, setShowScheduling] = useQueryStringState<string | undefined>("schedule");
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
              icon={<FaExternalLinkAlt className="w-2.5 h-2.5" />}
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
        return (
          <div className="flex items-center">
            <DestinationTitle destination={destination} />
            <JitsuButton
              type="link"
              icon={<FaExternalLinkAlt className="w-2.5 h-2.5" />}
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
      className: "text-right",
      width: "4%",
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
        if (!t?.status) {
          return <Tag>NO RUNS</Tag>;
        }
        return (
          //<div className={"flex flex-col items-end text-right"}>
          <Tag
            className={"cursor-pointer"}
            title={"Show logs"}
            onClick={() => {
              router.push(`/${workspace.slug || workspace.id}/syncs/logs?taskId=${t.taskId}&syncId=${t.syncId}`);
            }}
            color={color(t.status)}
            style={{ marginRight: 0 }}
          >
            {t.status} <FaExternalLinkAlt className={"inline ml-0.5 w-2.5 h-2.5"} />
          </Tag>
          //  <span className={"text-xxs text-gray-500"}>show logs</span>
          //</div>
        );
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
      title: <div className={"text-right"}>Actions</div>,
      render: (text, link) => {
        const t = tasks?.data?.tasks?.[link.id];
        const items: ButtonProps[] = [
          {
            disabled: t?.status === "RUNNING" || !!running,
            title: t?.status === "RUNNING" ? "Sync is already running" : undefined,
            icon:
              running == link.id ? (
                <JLucideIcon name={"loader-2"} className="animate-spin w-3.5 h-3.5" />
              ) : (
                <FaPlay className="w-3.5 h-3.5" />
              ),
            onClick: async () => {
              setRunning(link.id);
              try {
                const runStatus = await rpc(`/api/${workspace.id}/sources/run?syncId=${link.id}`);
                if (runStatus?.error) {
                  feedbackError(runStatus.error, { placement: "top" });
                } else {
                  router.push(
                    `/${workspace.slug || workspace.id}/syncs/tasks?query=${encodeURIComponent(
                      JSON5.stringify({
                        syncId: link.id,
                        notification: "Sync Started",
                      })
                    )}`
                  );
                }
              } catch (e) {
                feedbackError("Failed to run sync", { error: e, placement: "top" });
              } finally {
                setRunning(undefined);
              }
            },
            label: "Run",
          },
          {
            icon: <JLucideIcon name={"list-minus"} className={"w-5 h-5"} />,
            label: "Logs",
            href: `/syncs/tasks?query=${JSON5.stringify({ syncId: link.id })}`,
          },
          {
            icon: <JLucideIcon name={"pencil-line"} className={"w-4 h-4"} />,
            label: "Edit",
            href: `/syncs/edit?id=${link.id}`,
          },
          {
            disabled: t?.status === "RUNNING" || !!running,
            title: t?.status === "RUNNING" ? "Sync is already running" : undefined,
            icon:
              running == link.id ? (
                <JLucideIcon name={"loader-2"} className="animate-spin w-3.5 h-3.5" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              ),
            onClick: async () => {
              setRunning(link.id);
              try {
                const runStatus = await rpc(`/api/${workspace.id}/sources/run?syncId=${link.id}&fullSync=true`);
                if (runStatus?.error) {
                  feedbackError(runStatus.error, { placement: "top" });
                } else {
                  router.push(
                    `/${workspace.slug || workspace.id}/syncs/tasks?query=${encodeURIComponent(
                      JSON5.stringify({
                        syncId: link.id,
                        notification: "Sync Started",
                      })
                    )}`
                  );
                }
              } catch (e) {
                feedbackError("Failed to run sync", { error: e, placement: "top" });
              } finally {
                setRunning(undefined);
              }
            },
            label: "Full Sync",
          },
          {
            icon: <JLucideIcon name={"calendar-check"} className={"w-4 h-4"} />,
            onClick: async () => {
              setShowScheduling(link.id);
            },
            label: "Schedule (API)",
          },
          {
            icon: <FaTrash />,
            onClick: async () => {
              deleteSync(link);
            },
            danger: true,
            label: "Delete",
          },
        ];
        return <ButtonGroup collapseLast={3} items={items} />;
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
      {showScheduling && (
        <ScheduleDocumentation
          syncId={showScheduling}
          service={servicesById[linksById[showScheduling].fromId]}
          destination={destinationsById[linksById[showScheduling].toId]}
          onCancel={() => {
            setShowScheduling(undefined);
          }}
        />
      )}
    </div>
  );
}

function Syncs(props: RemoteEntitiesProps) {
  const { services, destinations, links } = props;
  const workspace = useWorkspace();
  if (props.services.length == 0 || props.destinations.length == 0) {
    return (
      <div className="flex flex-col justify-center items-center ">
        <JLucideIcon name={"inbox"} className="w-16 h-16 text-textDisabled" />
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

export const SyncTitle: React.FC<{
  syncId: string;
  service: ServiceConfig;
  destination: DestinationConfig;
  showLink?: boolean;
}> = ({ syncId, service, destination, showLink = false }) => {
  return (
    <div className={"flex flex-row whitespace-nowrap gap-1.5"}>
      <ServiceTitle size={"small"} service={service} />
      {"→"}
      <DestinationTitle size={"small"} destination={destination} />
      {showLink && (
        <WJitsuButton
          href={`/syncs/edit?id=${syncId}`}
          type="link"
          className="link"
          size="small"
          icon={<FaExternalLinkAlt className="w-2.5 h-2.5" />}
        />
      )}
    </div>
  );
};

const ScheduleDocumentation: React.FC<{
  syncId: string;
  service: ServiceConfig;
  destination: DestinationConfig;
  onCancel: () => void;
}> = ({ syncId, service, destination, onCancel }) => {
  const appConfig = useAppConfig();
  const workspace = useWorkspace();

  const displayDomain = appConfig.websiteUrl;
  return (
    <Overlay onClose={onCancel} className="px-6 py-6">
      <div className={"flex flex-row gap-2 border-b pb-2 mb-4"} style={{ minWidth: 900 }}>
        <SyncTitle syncId={syncId} service={service} destination={destination} />
      </div>
      <div className="flex flex-row">
        <div className={"flex-shrink prose-sm max-w-none overflow-auto"}>
          <h2 id={"scheduling"}>Scheduling Sync</h2>
          <Alert
            type="warning"
            showIcon
            message={<b>Service Sync Beta</b>}
            description={
              <>
                Jitsu Next Service Sync is currently in Beta. Scheduling of sync tasks is not yet implemented.
                <br />
                But you can use API endpoint that trigger sync together with third-party scheduling tools like{" "}
                <a target={"_blank"} rel={"noreferrer noopener"} href={"https://cloud.google.com/scheduler"}>
                  Google Cloud Scheduler
                </a>
                , cron, Airflow, ...
              </>
            }
          />
          <h2 id={"trigger"}>Trigger Sync</h2>
          <h3>Endpoint</h3>
          <CodeBlock>{`${displayDomain}/api/${workspace.id}/sources/run?syncId=${syncId}`}</CodeBlock>
          <ul>
            <li>
              <b>syncId</b> - id of Sync object
            </li>
            <li>
              <b>fullSync</b> - optional, boolean, if true - saved state will be deleted and full sync will be performed
              replacing all source data in destination
            </li>
          </ul>
          <h3>Authorization</h3>
          Use <b>Authorization</b> header with <b>Bearer</b> token. You can obtain token in{" "}
          <Link href={"/user"}>Settings</Link> page.
          <h3>Example</h3>
          <CodeBlock lang={"bash"}>
            {`curl -H "Authorization: bearer abc:123" \\
"${displayDomain}/api/${workspace.id}/sources/run?syncId=${syncId}"`}
          </CodeBlock>
          <h3>Response</h3>
          Successful response:
          <CodeBlock lang={"json"}>{`{
    "ok": true,
    "taskId": "358877ad-7ad5-431f-bd7b-05badd29c6aa",
    "status": "${displayDomain}/api/${workspace.id}/sources/tasks?taskId=358877ad-7ad5-431f-bd7b-05badd29c6aa&syncId=${syncId}",
    "logs": "${displayDomain}/api/${workspace.id}/sources/logs?taskId=358877ad-7ad5-431f-bd7b-05badd29c6aa&syncId=${syncId}"
}`}</CodeBlock>
          * You can use <b>status</b> and <b>logs</b> links to check sync status and logs.
          <br />
          <br /> Error response:
          <CodeBlock lang={"json"}>{`{
    "ok": false,
    "error": "Sync is already running",
    "runningTask": {
        "taskId":"452110c3-26fc-43f0-b079-406af0c90047",
        "status":"${displayDomain}/api/${workspace.id}/sources/tasks?taskId=452110c3-26fc-43f0-b079-406af0c90047&syncId=${syncId}",
        "logs":"${displayDomain}/api/${workspace.id}/sources/logs?taskId=452110c3-26fc-43f0-b079-406af0c90047&syncId=${syncId}"
    }
}`}</CodeBlock>
          <h2 id={"status"}>Sync Status</h2>
          <h3>Endpoint</h3>
          <CodeBlock>{`${displayDomain}/api/${workspace.id}/sources/tasks?taskId={task id}&syncId=${syncId}`}</CodeBlock>
          <ul>
            <li>
              <b>syncId</b> - id of Sync object
            </li>
            <li>
              <b>taskId</b> - id of task returned in response of <b>Trigger sync</b> endpoint
            </li>
          </ul>
          <h3>Authorization</h3>
          Use <b>Authorization</b> header with <b>Bearer</b> token. You can obtain token in{" "}
          <Link href={"/user"}>Settings</Link> page.
          <h3>Example</h3>
          <CodeBlock lang={"bash"}>
            {`curl -H "Authorization: bearer abc:123" \\
"${displayDomain}/api/${workspace.id}/sources/tasks?taskId=452110c3-26fc-43f0-b079-406af0c90047&syncId=${syncId}"`}
          </CodeBlock>
          <h3>Response</h3>
          Successful response:
          <CodeBlock lang={"json"}>{`{
    "ok": true,
    "task": {
        "sync_id":"${syncId}",
        "task_id":"452110c3-26fc-43f0-b079-406af0c90047",
        "package":"${service.package}",
        "version":"${service.version}",
        "started_at":"2023-07-07T08:20:59.000Z",
        "updated_at":"2023-07-07T08:21:07.706Z",
        "status":"RUNNING",
        "description":"CREATED: "
    },
    "logs":"${displayDomain}/api/${workspace.id}/sources/logs?taskId=358877ad-7ad5-431f-bd7b-05badd29c6aa&syncId=${syncId}"
}`}</CodeBlock>
          * You can use <b>logs</b> link to check sync logs.
          <br />
          <br /> Error response:
          <CodeBlock lang={"json"}>{`{
    "ok":false,
    "error":"Task 452110c3-26fc-43f0-b079-406af0c90047 not found"
}`}</CodeBlock>
          <h2 id={"logs"}>Sync Logs</h2>
          <h3>Endpoint</h3>
          <CodeBlock>{`${displayDomain}/api/${workspace.id}/sources/logs?taskId={task id}&syncId=${syncId}`}</CodeBlock>
          <ul>
            <li>
              <b>syncId</b> - id of Sync object
            </li>
            <li>
              <b>taskId</b> - id of task returned in response of <b>Trigger sync</b> endpoint
            </li>
          </ul>
          <h3>Authorization</h3>
          Use <b>Authorization</b> header with <b>Bearer</b> token. You can obtain token in{" "}
          <Link href={"/user"}>Settings</Link> page.
          <h3>Example</h3>
          <CodeBlock lang={"bash"}>
            {`curl -H "Authorization: bearer abc:123" \\
"${displayDomain}/api/${workspace.id}/sources/logs?taskId=452110c3-26fc-43f0-b079-406af0c90047&syncId=${syncId}"`}
          </CodeBlock>
          <h3>Response</h3>
          Successful response:
          <CodeBlock
            lang={"plaintext"}
          >{`2023-07-07 08:21:05.737 INFO [jitsu] Sidecar. syncId: ${syncId}, taskId: 452110c3-26fc-43f0-b079-406af0c90047, package: ${service.package}:${service.version} startedAt: 2023-07-07T12:20:59+04:00
2023-07-07 08:21:05.832 INFO [jitsu] Catalog loaded. 36 streams selected
2023-07-07 08:21:05.833 INFO [jitsu] State loaded: {}
2023-07-07 08:21:06.573 INFO [${service.package}] Starting syncing...`}</CodeBlock>
          <br /> Error response:
          <CodeBlock
            lang={"plaintext"}
          >{`Error loading logs for task id 452110c3-26fc-43f0-b079-406af0c90047...`}</CodeBlock>
        </div>
        <div className={"ml-6 pt-2 px-6 hidden lg:block w-60 border-l flex-shrink-0"}>
          <div className="flex whitespace-nowrap fixed   flex-col space-y-3  ">
            <Link href="#scheduling">Scheduling Sync</Link>
            <Link href="#trigger">Trigger Sync</Link>
            <Link href="#status">Sync Status</Link>
            <Link href="#logs">Sync Logs</Link>
          </div>
        </div>
      </div>
    </Overlay>
  );
};

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
