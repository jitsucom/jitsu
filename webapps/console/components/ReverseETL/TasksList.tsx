import React, { useState } from "react";
import { DatePicker, Select, Table, Tooltip } from "antd";
import { CalendarIcon, Edit3, ListMinusIcon, Play, RefreshCw, UserIcon, XCircle } from "lucide-react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import { useRouter } from "next/router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { rpc } from "juava";
import { ReverseTask } from "../../lib/reverse-etl";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { confirmOp } from "../../lib/ui";
import { ButtonGroup, ButtonProps } from "../ButtonGroup/ButtonGroup";
import { JitsuButton, WJitsuButton } from "../JitsuButton/JitsuButton";
import { Failure, useReverseSyncs } from "./shared";
import { ReverseSyncTitle } from "./SyncTitle";
import { ReverseTaskStatus } from "./TaskStatus";
dayjs.extend(utc);
dayjs.extend(relativeTime);
const statuses = ["RUNNING", "SUCCESS", "FAILED", "WAITING", "RESUMED", "CANCELLED", "SKIPPED"];

export function ReverseTasksList() {
  const workspace = useWorkspace();
  const router = useRouter();
  const maintenance = !!useAppConfig().maintenance?.active;
  const enabled = workspace.featuresEnabled.includes("reverse-etl");
  const syncs = useReverseSyncs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const filters = Object.fromEntries(
    ["syncId", "status", "from", "to"].flatMap(key =>
      typeof router.query[key] === "string" ? [[key, router.query[key]]] : []
    )
  ) as Record<string, string>;
  const setFilters = (changes: Record<string, string | undefined>) =>
    router.push(
      {
        pathname: `/${workspace.slugOrId}/reverse-syncs/tasks`,
        query: Object.fromEntries(
          Object.entries({ ...filters, ...changes }).filter(([, value]) => value !== undefined)
        ),
      },
      undefined,
      { shallow: true }
    );
  const tasks = useQuery({
    queryKey: ["reverse-etl-task-list", workspace.id, filters],
    queryFn: async () =>
      z
        .object({ tasks: z.array(ReverseTask) })
        .parse(await rpc(`/api/${workspace.id}/reverse-etl/tasks`, { query: filters })),
    enabled: router.isReady,
    keepPreviousData: true,
    refetchInterval: 5000,
  });
  const perform = async (task: ReverseTask, action: "run" | "cancel") => {
    if (busy) return;
    if (
      action === "cancel" &&
      !(await confirmOp(
        "Cancel this attempt? Requests already in flight may still finish. Accepted changes and status-refresh evidence are kept."
      ))
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await rpc(`/api/${workspace.id}/reverse-etl/sync`, {
        method: "POST",
        query: { syncId: task.sync_id },
        body: { action, ...(action === "cancel" ? { taskId: task.task_id } : {}) },
      });
      await Promise.all([tasks.refetch(), syncs.refetch()]);
      if (action === "run")
        await router.push(
          `/${workspace.slugOrId}/reverse-syncs/${
            result.taskId ? `logs?syncId=${task.sync_id}&taskId=${result.taskId}` : `tasks?syncId=${task.sync_id}`
          }`
        );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const actions = (task: ReverseTask): ButtonProps[] => {
    const sync = syncs.data?.find(s => s.id === task.sync_id);
    return [
      {
        label: "Logs",
        icon: <ListMinusIcon className="w-5 h-5" />,
        href: `/reverse-syncs/logs?syncId=${task.sync_id}&taskId=${task.task_id}`,
      },
      {
        label: "Edit",
        icon: <Edit3 className="w-4 h-4" />,
        href: `/reverse-syncs?id=${task.sync_id}`,
        requiredPermission: "editEntities",
        disabled: !sync,
      },
      ["RUNNING", "WAITING"].includes(task.status)
        ? {
            label: "Cancel",
            icon: <XCircle className="w-4 h-4" />,
            danger: true,
            requiredPermission: "editEntities",
            disabled: busy || maintenance,
            onClick: () => void perform(task, "cancel"),
          }
        : {
            label: "Run",
            icon: <Play className="w-4 h-4" />,
            requiredPermission: "editEntities",
            disabled:
              busy ||
              maintenance ||
              !enabled ||
              !sync ||
              sync.options.disabled ||
              ["RUNNING", "WAITING"].includes(sync.latestTask?.status ?? ""),
            onClick: () => void perform(task, "run"),
          },
    ];
  };
  return (
    <>
      <h1 className="text-3xl pb-6">Reverse Sync Tasks</h1>
      <div className="flex flex-wrap items-center gap-3 pb-6">
        <Select
          className="min-w-64"
          placeholder="All reverse syncs"
          allowClear
          showSearch
          optionFilterProp="search"
          value={filters.syncId}
          options={syncs.data?.map(s => ({
            value: s.id,
            search: `${s.id} ${s.modelName} ${s.destinationName}`,
            label: <ReverseSyncTitle sync={s} syncId={s.id} link={false} />,
          }))}
          onChange={syncId => void setFilters({ syncId })}
        />
        <Select
          className="w-44"
          placeholder="All statuses"
          allowClear
          value={filters.status}
          options={statuses.map(value => ({ value, label: value }))}
          onChange={status => void setFilters({ status })}
        />
        <DatePicker.RangePicker
          showTime
          allowEmpty={[true, true]}
          placeholder={["From (UTC)", "To (UTC)"]}
          value={[filters.from ? dayjs.utc(filters.from) : null, filters.to ? dayjs.utc(filters.to) : null]}
          onChange={dates =>
            void setFilters({ from: dates?.[0]?.utc(true).toISOString(), to: dates?.[1]?.utc(true).toISOString() })
          }
        />
        <JitsuButton
          icon={<RefreshCw className={`w-4 h-4 ${tasks.isFetching ? "animate-spin" : ""}`} />}
          onClick={() => void tasks.refetch()}
        >
          Refresh
        </JitsuButton>
        <WJitsuButton href="/reverse-syncs">Back to syncs</WJitsuButton>
      </div>
      <Failure error={error || tasks.error || syncs.error} />
      <Table<ReverseTask>
        size="small"
        className="border border-backgroundDark rounded-lg"
        rowKey="task_id"
        loading={tasks.isLoading || busy}
        dataSource={tasks.data?.tasks ?? []}
        pagination={false}
        scroll={{ x: 1200 }}
        columns={[
          {
            title: "",
            width: 35,
            render: (_, task) => (
              <Tooltip
                title={
                  task.trigger === "recovery"
                    ? "Status refresh"
                    : task.trigger === "scheduled"
                    ? "Scheduled"
                    : task.trigger === "manual"
                    ? "Manual"
                    : "Unknown trigger"
                }
              >
                {task.trigger === "manual" ? (
                  <UserIcon className="w-4 h-4" />
                ) : task.trigger === "scheduled" ? (
                  <CalendarIcon className="w-4 h-4" />
                ) : task.trigger === "recovery" ? (
                  <RefreshCw className="w-4 h-4" />
                ) : (
                  "—"
                )}
              </Tooltip>
            ),
          },
          {
            title: "Started (UTC)",
            className: "whitespace-nowrap",
            render: (_, task) => (
              <Tooltip title={task.started_at.toISOString()}>
                <div>
                  {dayjs(task.started_at).fromNow()}
                  <div className="text-xxs text-gray-500">
                    {dayjs(task.started_at).utc().format("MMM DD, HH:mm:ss")}
                  </div>
                </div>
              </Tooltip>
            ),
          },
          {
            title: "Sync",
            render: (_, task) => (
              <ReverseSyncTitle sync={syncs.data?.find(s => s.id === task.sync_id)} syncId={task.sync_id} />
            ),
          },
          {
            title: "Duration",
            className: "whitespace-nowrap",
            render: (_, task) =>
              `${Math.max(
                0,
                Math.round(
                  ((task.status === "RUNNING" ? Date.now() : task.updated_at.getTime()) - task.started_at.getTime()) /
                    1000
                )
              )}s`,
          },
          {
            title: "Status",
            className: "text-right whitespace-nowrap",
            render: (_, task) => <ReverseTaskStatus task={task} />,
          },
          {
            title: "Batches",
            className: "text-right",
            render: (_, task) =>
              task.stats ? (
                <Tooltip title="Fully accepted / batches created so far. Click status for outcomes by batch type.">
                  {task.stats.upsert.accepted + task.stats.remove.accepted} /{" "}
                  {task.stats.upsert.total + task.stats.remove.total}
                </Tooltip>
              ) : (
                "—"
              ),
          },
          {
            title: "Records",
            className: "text-right whitespace-nowrap",
            render: (_, task) =>
              task.stats ? (
                <Tooltip title="API records, not matched audience size">
                  <div>
                    {task.stats.records.accepted.toLocaleString()} accepted
                    <div className="text-xxs text-gray-500">
                      {task.stats.records.pending.toLocaleString()} pending ·{" "}
                      {task.stats.records.rejected.toLocaleString()} rejected
                    </div>
                  </div>
                </Tooltip>
              ) : (
                "—"
              ),
          },
          {
            title: <div className="text-right">Actions</div>,
            render: (_, task) => <ButtonGroup items={actions(task)} />,
          },
        ]}
      />
      <p className="text-xs text-textLight mt-3">
        Latest 100 attempts matching these filters. Batch counters include earlier attempts of the same logical run.
      </p>
    </>
  );
}
