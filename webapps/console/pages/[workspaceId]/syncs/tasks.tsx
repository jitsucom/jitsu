import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import { useApi } from "../../../lib/useApi";
import { source_taskDbModel } from "../../../prisma/schema";
import { z } from "zod";
import { DatePicker, notification, Popconfirm, Select, Table, Tag } from "antd";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryStringState } from "../../../lib/useQueryStringState";
import { ColumnType } from "antd/es/table/interface";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import JSON5 from "json5";
import { ErrorCard } from "../../../components/GlobalError/GlobalError";
import { useLinksQuery } from "../../../lib/queries";
import { arrayToMap } from "../../../lib/shared/arrays";
import { JitsuButton, WJitsuButton } from "../../../components/JitsuButton/JitsuButton";
import { FaExternalLinkAlt, FaRegPlayCircle } from "react-icons/fa";
import { useRouter } from "next/router";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { SyncTitle } from "./index";
import JLucideIcon from "../../../components/Icons/JLucideIcon";
import RefreshCw from "../../../components/Icons/RefreshCw";

dayjs.extend(utc);
dayjs.extend(relativeTime);
type DatesRange = [string | null, string | null];

const formatDate = (date: string | Date) => dayjs(date, "YYYY-MM-DDTHH:mm:ss.SSSZ").utc().format("YYYY-MM-DD HH:mm:ss");

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

type TasksTableProps = {
  tasks: TasksDbModel[];
  loading: boolean;
  linksMap?: Record<string, { id: string; fromId: string; toId: string }>;
  servicesMap?: Record<string, any>;
  destinationsMap?: Record<string, any>;
};

function TasksTable({ tasks, loading, linksMap, servicesMap, destinationsMap }: TasksTableProps) {
  const router = useRouter();
  const workspace = useWorkspace();
  const columns: ColumnType<TasksDbModel>[] = [
    {
      title: <div className={"whitespace-nowrap"}>Started (UTC)</div>,
      key: "started_at",
      width: "12%",
      render: (text, task) => {
        return <div className={"whitespace-nowrap"}>{formatDate(task.started_at)}</div>;
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
              />
            );
          }
        }
        return <div className={"whitespace-nowrap"}>{task.sync_id}</div>;
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Duration</div>,
      key: "updated_at",
      width: "12%",
      render: (text, task) => {
        return <div className={"whitespace-nowrap"}>{dayjs(task.updated_at).from(dayjs(task.started_at), true)}</div>;
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Sync Status</div>,
      key: "status",
      className: "text-right",
      width: "5%",
      render: (text, task) => {
        switch (task.status) {
          case "SUCCESS":
            try {
              const des = JSON.parse(task.description || "{}");
              //sum des values
              let processed_rows = 0;
              let processed_bytes = 0;
              for (const key in des) {
                const stat = des[key];
                if (typeof stat === "number") {
                  processed_rows += des[key];
                } else if (typeof stat === "object") {
                  processed_rows += des[key].events;
                  processed_bytes += des[key].bytes;
                }
              }
              return (
                <div className={"flex flex-col items-end text-right"}>
                  <Tag color={"green"} style={{ marginRight: 0 }}>
                    SUCCESS
                  </Tag>
                  <span className={"text-xxs text-gray-500"}>{processed_rows.toLocaleString()} rows</span>
                  <span className={"text-xxs text-gray-500"}>{formatBytes(processed_bytes)}</span>
                </div>
              );
            } catch (e) {}
            return (
              <Tag color={"green"} style={{ marginRight: 0 }}>
                SUCCESS
              </Tag>
            );
          case "FAILED":
            const popoverContent = (
              <div className={"max-h-96 overflow-y-auto"}>
                <div className={"whitespace-pre-wrap font-mono text-xs"}>{task.description}</div>
              </div>
            );
            return (
              <Popconfirm
                description={popoverContent}
                overlayClassName={"w-1/2"}
                placement={"topRight"}
                title={"Error"}
                trigger={"click"}
                icon={<ExclamationCircleOutlined style={{ color: "red" }} />}
                showCancel={false}
              >
                <button className={"outline-0"}>
                  <div className={"flex flex-col items-end text-right cursor-pointer"}>
                    <Tag color={"red"} style={{ marginRight: 0 }}>
                      FAILED <FaExternalLinkAlt className={"inline ml-0.5 w-2.5 h-2.5"} />
                    </Tag>
                    <span className={"text-xxs text-gray-500"}>show error</span>
                  </div>
                </button>
              </Popconfirm>
            );
          case "RUNNING":
            return (
              <Tag color={"blue"} style={{ marginRight: 0 }}>
                RUNNING
              </Tag>
            );
        }
      },
    },
    {
      title: "",
      key: "actions",
      render: (text, task) => {
        return (
          <WJitsuButton
            icon={<JLucideIcon name={"file-text"} />}
            type={"link"}
            title={"View logs"}
            href={`/syncs/logs?taskId=${task.task_id}&syncId=${task.sync_id}`}
          >
            View Logs
          </WJitsuButton>
        );
      },
    },
  ];
  return (
    <div>
      <Table
        rowKey={"task_id"}
        size={"small"}
        // onRow={record => {
        //   return {
        //     onClick: () => {
        //       router.push(
        //         `/${workspace.slug || workspace.id}/syncs/logs?taskId=${record.task_id}&syncId=${record.sync_id}`
        //       );
        //     },
        //   };
        // }}
        dataSource={tasks}
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
  const [linksMap, setLinksMap] = useState<Record<string, { fromId: string; toId: string; id: string }> | undefined>(
    undefined
  );
  const [servicesMap, setServicesMap] = useState<Record<string, any> | undefined>(undefined);
  const [destinationsMap, setDestinationsMap] = useState<Record<string, any> | undefined>(undefined);

  const {
    data: linksData,
    isLoading: linksLoading,
    error: linksError,
  } = useLinksQuery(workspace.id, "sync", {
    cacheTime: 0,
    retry: false,
  });

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

  useEffect(() => {
    if (linksData) {
      setServicesMap(arrayToMap(linksData[0]));
      setDestinationsMap(arrayToMap(linksData[1]));
      setLinksMap(arrayToMap(linksData[2]));
    }
  }, [linksData]);

  useEffect(() => {
    if (linksData) {
      if (!state.syncId) {
        patchQueryStringState("syncId", linksData[2][0]?.id);
      }
    }
  }, [linksData, patchQueryStringState, state.syncId]);

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
                loading={linksLoading}
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
                    value: "SUCCESS",
                    label: (
                      <div>
                        <Tag color={"green"}>SUCCESS</Tag>
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
              icon={<JLucideIcon name={"chevron-left"} className="w-6 h-6" />}
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
