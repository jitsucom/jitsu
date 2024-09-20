import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import { useApi } from "../../../lib/useApi";
import { source_taskDbModel } from "../../../prisma/schema";
import { z } from "zod";
import { DatePicker, notification, Popover, Select, Table, Tag, Tooltip } from "antd";
import React, { PropsWithChildren, useCallback, useEffect, useMemo, useState } from "react";
import { useQueryStringState } from "../../../lib/useQueryStringState";
import { ColumnType } from "antd/es/table/interface";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import JSON5 from "json5";
import { ErrorCard } from "../../../components/GlobalError/GlobalError";
import { arrayToMap } from "../../../lib/shared/arrays";
import { JitsuButton, WJitsuButton } from "../../../components/JitsuButton/JitsuButton";
import {
  AlertCircle,
  CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  Edit3,
  ListMinusIcon,
  PlayCircle,
  RefreshCw,
  UserIcon,
  XCircle,
} from "lucide-react";
import { FaExternalLinkAlt, FaRegPlayCircle } from "react-icons/fa";
import { useRouter } from "next/router";
import { displayTaskRunError, formatDate, SyncTitle } from "./index";
import { ButtonGroup, ButtonProps } from "../../../components/ButtonGroup/ButtonGroup";
import { rpc } from "juava";
import { feedbackError, feedbackSuccess, useKeyboard } from "../../../lib/ui";
import hash from "object-hash";
import { useConfigObjectLinks, useConfigObjectList } from "../../../lib/store";
import { Spinner } from "../../../components/GlobalLoader/GlobalLoader";
import { MdOutlineCancel } from "react-icons/md";

dayjs.extend(utc);
dayjs.extend(relativeTime);
type DatesRange = [string | null, string | null];

const formatBytes = bytes => {
  const dp = 1;
  const thresh = 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " bytes";
  }

  const units = ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

  return bytes.toFixed(dp) + " " + units[u];
};

type TasksDbModel = z.infer<typeof source_taskDbModel>;

type TaskStats = {
  stats: any;
  totalStreams: number;
  successStreams: number;
  processedRows: number;
  processedBytes: number;
};

type TasksTableProps = {
  tasks: TasksDbModel[];
  loading: boolean;
  linksMap?: Record<string, { id: string; fromId: string; toId: string }>;
  servicesMap?: Record<string, any>;
  destinationsMap?: Record<string, any>;
  refreshCb?: () => void;
};

function TaskStatus0({ task, loading }: { task: TasksDbModel & TaskStats; loading?: boolean }) {
  if (loading) {
    return (
      <button className={"outline-0"}>
        <div className={"flex flex-col items-end text-right cursor-pointer"}>
          <Tag style={{ marginRight: 0 }}>
            LOADING <Spinner className={"inline ml-0.5 w-3 h-3"} />
          </Tag>
          <span className={"text-xxs text-gray-500"}>&nbsp;</span>
        </div>
      </button>
    );
  }
  if (!task.status) {
    return (
      <button className={"outline-0"}>
        <div className={"flex flex-col items-end text-right cursor-pointer"}>
          <Tag style={{ marginRight: 0 }}>NO RUNS</Tag>
          <span className={"text-xxs text-gray-500"}>&nbsp;</span>
        </div>
      </button>
    );
  }

  const SyncStatus: React.FC<
    PropsWithChildren<{ status: "PARTIAL" | "CANCELLED" | "FAILED" | "SUCCESS" | "RUNNING" | "SKIPPED" }>
  > = props => {
    const [showPopover, setShowPopover] = useState(false);
    const handleOpenChange = (newOpen: boolean) => {
      setShowPopover(newOpen);
    };
    useKeyboard("Escape", () => {
      if (showPopover) {
        setShowPopover(false);
      }
    });

    const popoverContent = (
      <div>
        <div className={"overflow-y-auto"} style={{ maxHeight: "60vh" }}>
          {task.stats ? (
            <TaskStatusResultTable
              stats={Object.entries(task.stats).reduce((arr, v) => {
                const o = { key: v[0], stream: v[0], ...(v[1] as any) };
                arr.push(o);
                return arr;
              }, [] as any[])}
            />
          ) : (
            <div className={"whitespace-pre-wrap font-mono text-xs"}>{task.description}</div>
          )}
        </div>
        <div className={"flex flex-row w-full gap-2 justify-end pt-2"}>
          <WJitsuButton
            icon={<ListMinusIcon className={"w-5 h-5"} />}
            type={"primary"}
            ghost
            href={`/syncs/logs?taskId=${task.task_id}&syncId=${task.sync_id}`}
          >
            Show Logs
          </WJitsuButton>
          <JitsuButton
            type={"primary"}
            onClick={() => {
              setShowPopover(false);
            }}
          >
            Ok
          </JitsuButton>
        </div>
      </div>
    );

    const icon =
      props.status === "SUCCESS" ? (
        <CheckCircle2 style={{ color: "green" }} />
      ) : props.status === "PARTIAL" ? (
        <AlertCircle style={{ color: "orange" }} />
      ) : props.status === "RUNNING" ? (
        <PlayCircle style={{ color: "blue" }} />
      ) : props.status === "SKIPPED" ? (
        <XCircle style={{ color: "orange" }} />
      ) : props.status === "CANCELLED" ? (
        <XCircle style={{ color: "gray" }} />
      ) : (
        <XCircle style={{ color: "red" }} />
      );
    return (
      <Popover
        open={showPopover}
        content={popoverContent}
        overlayClassName={"w-1/2"}
        onOpenChange={handleOpenChange}
        placement={"left"}
        title={
          <div className={"flex flex-row gap-1.5"}>
            {icon}
            {props.status}
          </div>
        }
        trigger={"click"}
      >
        <button className={"outline-0"}>
          <div className={"flex flex-col items-end text-right cursor-pointer"}>{props.children}</div>
        </button>
      </Popover>
    );
  };

  switch (task.status) {
    case "SUCCESS":
      if (task.stats) {
        return (
          <SyncStatus status={task.status}>
            <Tag color={"green"} style={{ marginRight: 0 }}>
              SUCCESS <FaExternalLinkAlt className={"inline ml-0.5 w-2.5 h-2.5"} />
            </Tag>
            <span className={"text-xxs text-gray-500"}>show stats</span>
          </SyncStatus>
        );
      } else {
        return (
          <Tag color={"green"} style={{ marginRight: 0 }}>
            SUCCESS
          </Tag>
        );
      }
    case "PARTIAL":
      return (
        <SyncStatus status={task.status}>
          <Tag color={"orange"} style={{ marginRight: 0 }}>
            PARTIAL <FaExternalLinkAlt className={"inline ml-0.5 w-2.5 h-2.5"} />
          </Tag>
          <span className={"text-xxs text-gray-500"}>show stats</span>
        </SyncStatus>
      );
    case "CANCELLED":
      return (
        <SyncStatus status={task.status}>
          <Tag style={{ marginRight: 0 }}>
            CANCELLED <FaExternalLinkAlt className={"inline ml-0.5 w-2.5 h-2.5"} />
          </Tag>
          <span className={"text-xxs text-gray-500"}>show stats</span>
        </SyncStatus>
      );
    case "SKIPPED":
      return (
        <SyncStatus status={task.status}>
          <Tag style={{ marginRight: 0 }}>
            SKIPPED <FaExternalLinkAlt className={"inline ml-0.5 w-2.5 h-2.5"} />
          </Tag>
          <span className={"text-xxs text-gray-500"}>show reason</span>
        </SyncStatus>
      );
    case "FAILED":
      return (
        <SyncStatus status={task.status}>
          <Tag color={"red"} style={{ marginRight: 0 }}>
            FAILED <FaExternalLinkAlt className={"inline ml-0.5 w-2.5 h-2.5"} />
          </Tag>
          <span className={"text-xxs text-gray-500"}>show error</span>
        </SyncStatus>
      );
    case "RUNNING":
      return (
        <SyncStatus status={task.status}>
          <Tag color={"blue"} style={{ marginRight: 0 }}>
            RUNNING <FaExternalLinkAlt className={"inline ml-0.5 w-2.5 h-2.5"} />
          </Tag>
          <span className={"text-xxs text-gray-500"}>show stats</span>
        </SyncStatus>
      );
    default:
      return <Tag style={{ marginRight: 0 }}>{task.status}</Tag>;
  }
}

export const TaskStatus = React.memo(TaskStatus0, (p, n) => hash(p) === hash(n));

function TaskStatusResultTable({ stats }: { stats: any[] }) {
  const columns: ColumnType<any>[] = [
    {
      title: "Stream",
      dataIndex: "stream",
      key: "stream",
      width: "100%",
      className: "font-mono",
    },
    Table.EXPAND_COLUMN,
    {
      title: "Status",
      key: "status",
      render: (text, record) => {
        if (record.status === "SUCCESS") {
          return <Tag color="green">SUCCESS</Tag>;
        } else if (record.status === "PARTIAL") {
          return <Tag color="orange">PARTIAL</Tag>;
        } else if (record.status === "CANCELLED") {
          return <Tag>CANCELLED</Tag>;
        } else if (record.status === "PENDING") {
          return <Tag>PENDING</Tag>;
        } else if (record.status === "RUNNING") {
          return <Tag color="blue">RUNNING</Tag>;
        } else {
          return <Tag color="red">{record.status}</Tag>;
        }
      },
    },
    {
      title: "Rows",
      dataIndex: "events",
      key: "rows",
      className: "text-right text-xs whitespace-nowrap",
      render: (text, record) => {
        return record.events ? record.events.toLocaleString() : 0;
      },
    },
    {
      title: "Size",
      dataIndex: "bytes",
      render: (text, record) => {
        return formatBytes(record.bytes);
      },
      key: "size",
      className: "text-right text-xs whitespace-nowrap",
    },
  ];
  return (
    <Table
      size={"small"}
      columns={columns}
      dataSource={stats}
      pagination={false}
      expandable={{
        rowExpandable: record => record.status === "FAILED" || record.status === "PARTIAL",
        expandedRowRender: record => {
          return <pre className={"text-xs text-red-600 break-all whitespace-pre-wrap"}>{record.error}</pre>;
        },
      }}
    />
  );
}

export function processTaskStatus(task: TasksDbModel): TasksDbModel & TaskStats {
  let stats: any = undefined;
  try {
    stats = JSON.parse(task?.description || "{}");
  } catch (e) {}
  //sum des values
  const taskStats: TaskStats = {
    stats,
    totalStreams: 0,
    successStreams: 0,
    processedRows: 0,
    processedBytes: 0,
  };
  if (stats) {
    for (const key in stats) {
      taskStats.totalStreams++;
      const stat = stats[key];
      if (typeof stat === "number") {
        taskStats.successStreams++;
        taskStats.processedRows += stat;
        stats[key] = {
          events: stat,
          status: "SUCCESS",
        };
      } else if (typeof stat === "object") {
        if (stat.status === "SUCCESS") {
          taskStats.successStreams++;
        }
        taskStats.processedRows += stat.events;
        taskStats.processedBytes += stat.bytes;
      }
    }
  }
  return {
    ...task,
    ...taskStats,
  };
}

function TasksTable({ tasks, loading, linksMap, servicesMap, destinationsMap, refreshCb }: TasksTableProps) {
  const workspace = useWorkspace();
  const cancelTask = async (taskId: string, syncId: string, pkg: string) => {
    try {
      const cancelStatus = await rpc(
        `/api/${workspace.id}/sources/cancel?taskId=${taskId}&syncId=${syncId}&package=${pkg}`
      );
      if (cancelStatus?.error) {
        displayTaskRunError(workspace, cancelStatus);
      }
    } catch (e) {
      feedbackError("Failed to cancel sync", { error: e, placement: "top" });
    } finally {
      refreshCb && refreshCb();
    }
  };
  const rerun = async (syncId: string) => {
    try {
      const runStatus = await rpc(`/api/${workspace.id}/sources/run?syncId=${syncId}`);
      if (runStatus?.error) {
        displayTaskRunError(workspace, runStatus);
      } else {
        feedbackSuccess("Sync started");
      }
    } catch (e) {
      feedbackError("Failed to run sync", { error: e, placement: "top" });
    } finally {
      refreshCb && refreshCb();
    }
  };
  const tasksMapped = useMemo(() => {
    return (tasks ?? []).map(task => {
      return {
        key: task.task_id,
        ...processTaskStatus(task),
      };
    });
  }, [tasks]);
  const columns: ColumnType<(typeof tasksMapped)[number]>[] = [
    {
      title: <></>,
      key: "started_by",
      render: (text, t) => {
        const sb = (t.started_by || {}) as any;
        const trigger = sb.trigger;
        const icon =
          trigger === "manual" ? (
            <Tooltip title={"Run by " + sb.name || sb.email || ""}>
              <UserIcon className={"w-4 h-4"} />
            </Tooltip>
          ) : (
            <Tooltip title={"Scheduled run"}>
              <CalendarIcon className={"w-4 h-4"} />
            </Tooltip>
          );
        return icon;
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Started (UTC)</div>,
      key: "started_at",
      width: "12%",
      render: (text, t) => {
        return (
          <div className={"flex flex-col items-start"}>
            <span className={"whitespace-nowrap"}>{`${dayjs(t.started_at).fromNow(true)} ago`}</span>
            <div className={"text-xxs whitespace-nowrap text-gray-500"}>{t ? formatDate(t.started_at) : ""}</div>
          </div>
        );
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Sync</div>,
      key: "link",
      className: "w-full",
      render: (text, task) => {
        if (linksMap && servicesMap && destinationsMap) {
          const link = linksMap[task.sync_id];
          if (link) {
            return (
              <SyncTitle
                syncId={link.id}
                service={servicesMap[link.fromId]}
                destination={destinationsMap[link.toId]}
                showLink={true}
                className={"max-w-sm xl:max-w-fit"}
              />
            );
          }
        }
        return <div className={"whitespace-nowrap"}>{task.sync_id}</div>;
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Duration</div>,
      key: "duration",
      width: "12%",
      render: (text, task) => {
        //const hours = dayjs(task.updated_at).diff(dayjs(task.started_at), "hour", true);
        return (
          <Tooltip title={formatDate(task.updated_at) + " UTC"} color={"#888888"}>
            <div className={"whitespace-nowrap text-xs"}>
              {dayjs(task.updated_at).from(dayjs(task.started_at), true)}
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: <div className={"whitespace-nowrap text-right"}>Status</div>,
      key: "status",
      className: "text-right whitespace-nowrap",
      width: "5%",
      render: (text, task) => <TaskStatus task={task} />,
    },
    {
      title: <div className={"whitespace-nowrap"}>Streams</div>,
      key: "streams",
      width: "12%",
      className: "text-right",
      render: (text, task) => {
        if (task.status === "SUCCESS") {
          return <div className={"whitespace-nowrap"}>{task.successStreams}</div>;
        } else if (
          (task.status === "PARTIAL" || task.status === "RUNNING" || task.status === "CANCELLED") &&
          task.totalStreams
        ) {
          return (
            <div>
              {task.successStreams} / {task.totalStreams}
            </div>
          );
        } else {
          return <div className={"whitespace-nowrap"}>0</div>;
        }
      },
    },
    {
      title: <div className={"whitespace-nowrap text-right"}>Rows</div>,
      dataIndex: "processedRows",
      width: "12%",
      className: "text-right",
      render: (text, task) => {
        return (
          <div className={"flex flex-col items-end justify-self-end gap-1"}>
            <code className={"whitespace-nowrap font-normal"}>{(task.processedRows || 0).toLocaleString()}</code>
            <div className={"whitespace-nowrap text-xxs text-gray-500"}>{formatBytes(task.processedBytes)}</div>
          </div>
        );
      },
    },
    // {
    //   title: <div className={"whitespace-nowrap text-right"}>Data Size</div>,
    //   dataIndex: "processedRows",
    //   width: "12%",
    //   className: "text-right",
    //   render: (text, task) => {
    //     return <code className={"whitespace-nowrap font-normal"}>{formatBytes(task.processedBytes)}</code>;
    //   },
    // },
    {
      title: <div className={"text-right"}>Actions</div>,
      key: "actions",
      render: (text, task, index) => {
        const items: ButtonProps[] = [
          {
            icon: <ListMinusIcon className={"w-5 h-5"} />,
            href: `/syncs/logs?taskId=${task.task_id}&syncId=${task.sync_id}`,
            label: "Show Logs",
          },
          {
            icon: <Edit3 className={"w-5 h-5"} />,
            href: `/syncs/edit?id=${task.sync_id}`,
            label: "Edit Sync",
            collapsed: true,
          },
        ];
        if (task.status === "RUNNING") {
          items.push({
            icon: <MdOutlineCancel className={"w-5 h-5"} />,
            onClick: async () => {
              await cancelTask(task.task_id, task.sync_id, task.package);
            },
            danger: true,
            label: "Cancel",
            collapsed: true,
          });
        } else {
          items.push({
            icon: <PlayCircle className={"w-5 h-5"} />,
            onClick: async () => {
              await rerun(task.sync_id);
            },
            label: "Re-run",
            collapsed: true,
          });
        }
        return <ButtonGroup items={items} />;
      },
    },
  ];
  return (
    <div>
      <Table
        rowKey={"task_id"}
        size={"small"}
        dataSource={tasksMapped}
        sortDirections={["ascend", "descend"]}
        columns={columns}
        pagination={false}
        className="border border-backgroundDark rounded-lg"
        loading={loading}
      />
    </div>
  );
}

export type TasksViewState = {
  dates?: DatesRange;
  syncId?: string;
  status?: "all" | "SUCCESS" | "FAILED" | "RUNNING";
  notification?: string;
};

function Tasks() {
  const workspace = useWorkspace();
  const router = useRouter();
  const [api, contextHolder] = notification.useNotification();

  const defaultState: TasksViewState = {
    status: "all",
    syncId: "all",
  };
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useQueryStringState<TasksViewState>(`query`, {
    defaultValue: defaultState,
    parser: (value: string) => {
      return { ...defaultState, ...JSON5.parse(value) };
    },
    serializer: (value: TasksViewState) => {
      return JSON5.stringify(value);
    },
  });

  const linksMap = arrayToMap(useConfigObjectLinks({ type: "sync" }));
  const servicesMap = arrayToMap(useConfigObjectList("service"));
  const destinationsMap = arrayToMap(useConfigObjectList("destination"));

  const patchQueryStringState = useCallback(
    (key: string, value: any) => {
      if (state[key] === value) return;
      if (value === null) {
        const newState = { ...state };
        delete newState[key];
        setState(newState);
      } else {
        setState({
          ...state,
          [key]: value,
        });
      }
    },
    [state, setState]
  );

  useEffect(() => {
    if (state.notification) {
      api.info({
        message: state.notification,
        description: "",
        icon: <FaRegPlayCircle />,
        placement: "topRight",
      });
      patchQueryStringState("notification", null);
    }
  }, [state, api, patchQueryStringState]);

  const entitiesSelectOptions = useMemo(() => {
    if (linksMap && servicesMap && destinationsMap) {
      let syncs = Object.entries(linksMap).map(([linkId, link]) => ({
        value: linkId,
        key: linkId,
        label: (
          <SyncTitle
            syncId={link.id}
            service={servicesMap[link.fromId]}
            destination={destinationsMap[link.toId]}
            showLink={false}
          />
        ),
      }));
      syncs = [
        {
          key: "all",
          value: "all",
          label: <div key="all">All</div>,
        },
        ...syncs,
      ];
      return syncs;
    } else {
      return [];
    }
  }, [linksMap, servicesMap, destinationsMap]);

  let tasksUrl = `/api/${workspace.id}/sources/tasks?r=${refresh}`;
  if (state.syncId !== "all") {
    tasksUrl += `&syncId=${state.syncId}`;
  }
  if (state.status !== "all") {
    tasksUrl += `&status=${state.status}`;
  }
  if (state.dates) {
    if (state.dates.length > 0 && state.dates[0] !== null) {
      tasksUrl += `&from=${state.dates[0]}`;
    }
    if (state.dates.length > 1 && state.dates[1] !== null) {
      tasksUrl += `&to=${state.dates[1]}`;
    }
  }

  const [shownData, setShownData] = useState<any | undefined>();

  const { isLoading, data, error } = useApi(tasksUrl);

  useEffect(() => {
    if (data) {
      setShownData(data);
    }
  }, [data]);

  return (
    <>
      {contextHolder}
      <div className={"flex flex-row justify-between items-center gap-4 pb-3.5"}>
        <div key={"left"}>
          <div className={"flex flex-row gap-4"}>
            <div>
              <span>Syncs: </span>
              <Select
                dropdownMatchSelectWidth={false}
                notFoundContent={<div>Project doesn't have configured Syncs</div>}
                style={{ width: 300 }}
                onChange={e => {
                  patchQueryStringState("syncId", e);
                }}
                value={state.syncId}
                options={entitiesSelectOptions}
              />
            </div>
            <div>
              <span>Statuses: </span>
              <Select
                style={{ width: 120 }}
                value={state.status}
                onChange={e => {
                  patchQueryStringState("status", e);
                }}
                options={[
                  { value: "all", label: "All" },
                  {
                    value: "FAILED",
                    label: (
                      <div>
                        <Tag color={"red"}>FAILED</Tag>
                      </div>
                    ),
                  },
                  {
                    value: "SKIPPED",
                    label: (
                      <div>
                        <Tag>SKIPPED</Tag>
                      </div>
                    ),
                  },
                  {
                    value: "CANCELLED",
                    label: (
                      <div>
                        <Tag>CANCELLED</Tag>
                      </div>
                    ),
                  },
                  {
                    value: "SUCCESS",
                    label: (
                      <div>
                        <Tag color={"green"}>SUCCESS</Tag>
                      </div>
                    ),
                  },
                  {
                    value: "PARTIAL",
                    label: (
                      <div>
                        <Tag color={"orange"}>PARTIAL</Tag>
                      </div>
                    ),
                  },
                  {
                    value: "RUNNING",
                    label: (
                      <div>
                        <Tag color={"blue"}>RUNNING</Tag>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            <div>
              <span>Date range: </span>
              <DatePicker.RangePicker
                value={
                  (state.dates ?? [null, null]).map(d => (d ? dayjs(d, "YYYY-MM-DD") : null)).slice(0, 2) as [
                    Dayjs | null,
                    Dayjs | null
                  ]
                }
                allowEmpty={[true, true]}
                onChange={d => {
                  if (d) {
                    const dates = [d[0] ? d[0].format("YYYY-MM-DD") : null, d[1] ? d[1].format("YYYY-MM-DD") : null];
                    if (dates[0] === null && dates[1] === null) {
                      patchQueryStringState("dates", null);
                    } else {
                      patchQueryStringState("dates", dates);
                    }
                  } else {
                    patchQueryStringState("dates", null);
                  }
                }}
              />
            </div>
          </div>
        </div>
        <div key={"actions"}>
          <div className={"flex flex-row"}>
            <JitsuButton
              icon={<RefreshCw className={`w-6 h-6 ${isLoading && refresh > 0 && "animate-spin"}`} />}
              type="link"
              size="small"
              onClick={() => {
                setRefresh(refresh + 1);
              }}
            >
              Refresh
            </JitsuButton>
            <JitsuButton
              icon={<ChevronLeft className="w-6 h-6" />}
              type="link"
              size="small"
              onClick={() => router.push(`/${workspace.slug || workspace.id}/syncs`)}
            >
              Back
            </JitsuButton>
          </div>
        </div>
      </div>
      {error ? (
        <ErrorCard error={error}></ErrorCard>
      ) : (
        <TasksTable
          tasks={shownData ? shownData.tasks : []}
          loading={isLoading}
          linksMap={linksMap}
          servicesMap={servicesMap}
          destinationsMap={destinationsMap}
          refreshCb={() => setRefresh(refresh + 1)}
        />
      )}
    </>
  );
}

const TasksPage = () => {
  return (
    <WorkspacePageLayout>
      <div className="flex mt-4 mb-4">
        <h1 className="text-3xl">Sync Tasks</h1>
      </div>
      <Tasks />
    </WorkspacePageLayout>
  );
};

export default TasksPage;
