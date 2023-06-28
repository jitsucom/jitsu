import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import { useApi } from "../../../lib/useApi";
import { source_taskDbModel } from "../../../prisma/schema";
import { z } from "zod";
import { Button, Col, DatePicker, Row, Select, Space, Table, Tag } from "antd";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryStringState } from "../../../lib/useQueryStringState";
import { ColumnType } from "antd/es/table/interface";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import JSON5 from "json5";
import { ErrorCard } from "../../../components/GlobalError/GlobalError";
import { LabelEllipsis } from "../../../components/LabelEllipsis/LabelEllipsis";
import { useLinksQuery } from "../../../lib/queries";
import { DestinationTitle } from "../destinations";
import { arrayToMap } from "../../../lib/shared/arrays";
import { ServiceTitle } from "../services";
import { WJitsuButton } from "../../../components/JitsuButton/JitsuButton";
import { FileText } from "lucide-react";

dayjs.extend(utc);
dayjs.extend(relativeTime);
type DatesRange = [string | null, string | null];

const formatDate = (date: string | Date) => dayjs(date, "YYYY-MM-DDTHH:mm:ss.SSSZ").utc().format("YYYY-MM-DD HH:mm:ss");

type TasksDbModel = z.infer<typeof source_taskDbModel>;

type TasksTableProps = {
  tasks: TasksDbModel[];
  loading: boolean;
  reloadCallback: () => void;
};

function TasksTable({ tasks, loading, reloadCallback }: TasksTableProps) {
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
      title: <div className={"whitespace-nowrap"}>Sync Status</div>,
      key: "status",
      width: "5%",
      render: (text, task) => {
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
        return <Tag color={color(task.status)}>{task.status}</Tag>;
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Duration</div>,
      key: "updated_at",
      render: (text, task) => {
        return <div className={"whitespace-nowrap"}>{dayjs(task.updated_at).from(dayjs(task.started_at), true)}</div>;
      },
    },
    {
      title: "Description",
      key: "description",
      render: (text, task) => {
        return (
          <LabelEllipsis trim={"end"} maxLen={100}>
            {task.description ?? ""}
          </LabelEllipsis>
        );
      },
      width: "70%",
    },
    {
      title: "",
      key: "actions",
      render: (text, task) => {
        return (
          <WJitsuButton
            icon={<FileText />}
            type={"text"}
            title={"View logs"}
            href={`/syncs/logs?taskId=${task.task_id}&syncId=${task.sync_id}`}
          />
        );
      },
    },
  ];
  return (
    <div>
      <Table
        rowKey={"task_id"}
        size={"small"}
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
};

function Tasks() {
  const workspace = useWorkspace();

  const defaultState: TasksViewState = {
    status: "all",
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
    if (linksData) {
      if (!state.syncId) {
        patchQueryStringState("syncId", linksData[2][0]?.id);
      }
    }
  }, [linksData, patchQueryStringState, state.syncId]);

  const entitiesSelectOptions = useMemo(() => {
    if (linksData) {
      const services = arrayToMap(linksData[0]);
      const destinations = arrayToMap(linksData[1]);
      const links = arrayToMap(linksData[2]) as Record<string, { fromId: string; toId: string }>;
      let syncs = Object.entries(links).map(entity => ({
        value: entity[0],
        key: entity[0],
        label: (
          <Space key={entity[0]}>
            <ServiceTitle size={"small"} service={services[entity[1].fromId]} />
            {"→"}
            <DestinationTitle size={"small"} destination={destinations[entity[1].toId]} />
          </Space>
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
  }, [linksData]);

  let tasksUrl = `/api/${workspace.id}/sources/tasks?syncId=${state.syncId}&r=${refresh}`;
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

  const { isLoading, data, error } = useApi(tasksUrl);

  return (
    <>
      <Row justify={"space-around"} wrap className={"pb-3.5"}>
        <Col key={"syncs"}>
          <span>Syncs: </span>
          <Select
            notFoundContent={<div>Project doesn't have configured Syncs</div>}
            style={{ width: 300 }}
            loading={linksLoading}
            onChange={e => {
              patchQueryStringState("syncId", e);
            }}
            value={state.syncId}
            options={entitiesSelectOptions}
          />
        </Col>
        <Col key={"statuses"}>
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
        </Col>
        <Col key={"dates"}>
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
        </Col>
        <Col key={"actions"}>
          <Button
            type="primary"
            ghost
            onClick={e => {
              setRefresh(refresh + 1);
            }}
          >
            Refresh
          </Button>
        </Col>
      </Row>
      {error ? (
        <ErrorCard error={error}></ErrorCard>
      ) : (
        <TasksTable tasks={data ? data.tasks : []} loading={isLoading} reloadCallback={() => {}} />
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
