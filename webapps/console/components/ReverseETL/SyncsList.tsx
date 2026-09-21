import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Button, Empty, Input, Table, Tooltip } from "antd";
import { Edit3, ListMinusIcon, Pause, Play, Plus, RefreshCw, Search, Trash2, XCircle } from "lucide-react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import { rpc } from "juava";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { useConfigObjectList } from "../../lib/store";
import { useQueryStringState } from "../../lib/useQueryStringState";
import { confirmOp } from "../../lib/ui";
import { ReverseSyncView } from "../../lib/reverse-etl";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import { ModelTitle } from "./ModelTitle";
import { ButtonGroup, ButtonProps } from "../ButtonGroup/ButtonGroup";
import { WJitsuButton } from "../JitsuButton/JitsuButton";
import { Failure, useReverseSyncs } from "./shared";
import { ReverseTaskStatus } from "./TaskStatus";
dayjs.extend(utc);
dayjs.extend(relativeTime);

export function ReverseSyncsList() {
  const workspace = useWorkspace(),
    router = useRouter();
  const maintenance = !!useAppConfig().maintenance?.active;
  const enabled = workspace.featuresEnabled.includes("reverse-etl");
  const destinations = useConfigObjectList("destination");
  const syncs = useReverseSyncs();
  const [search, setSearch] = useQueryStringState("search", { defaultValue: "", skipHistory: true });
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const data = (syncs.data ?? []).filter(
    s =>
      (!router.query.modelId || s.fromId === router.query.modelId) &&
      (!router.query.destinationId || s.toId === router.query.destinationId) &&
      [s.id, s.fromId, s.toId, s.modelName, s.destinationName].some(v =>
        v?.toLowerCase().includes(search.trim().toLowerCase())
      )
  );
  const perform = async (sync: ReverseSyncView, action: "run" | "pause" | "enable" | "delete") => {
    if (busy) return;
    if (
      action === "delete" &&
      !(await confirmOp("Delete this paused reverse sync? Its audience and runtime state will be retained."))
    )
      return;
    setBusy(sync.id);
    setError(undefined);
    try {
      const result = await rpc(`/api/${workspace.id}/reverse-etl/sync`, {
        query: { syncId: sync.id },
        method: action === "run" ? "POST" : action === "delete" ? "DELETE" : "PUT",
        ...(action === "delete"
          ? {}
          : { body: action === "run" ? { action: "run" } : { disabled: action === "pause" } }),
      });
      await syncs.refetch();
      if (action === "run")
        await router.push(
          `/${workspace.slugOrId}/reverse-syncs/${
            result.taskId ? `logs?syncId=${sync.id}&taskId=${result.taskId}` : `tasks?syncId=${sync.id}`
          }`
        );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };
  const actions = (sync: ReverseSyncView): ButtonProps[] => {
    const active = ["RUNNING", "WAITING"].includes(sync.latestTask?.status ?? "");
    return [
      {
        label: "Run",
        icon: <Play className="w-4 h-4" />,
        requiredPermission: "editEntities",
        disabled: !enabled || maintenance || sync.options.disabled || active || !!busy,
        onClick: () => void perform(sync, "run"),
      },
      { label: "Logs", icon: <ListMinusIcon className="w-5 h-5" />, href: `/reverse-syncs/tasks?syncId=${sync.id}` },
      {
        label: "Edit",
        icon: <Edit3 className="w-4 h-4" />,
        href: `/reverse-syncs?id=${sync.id}`,
        requiredPermission: "editEntities",
      },
      {
        label: sync.options.disabled ? "Enable" : "Pause",
        icon: <Pause className="w-4 h-4" />,
        collapsed: true,
        requiredPermission: "editEntities",
        disabled: maintenance || !!busy || (sync.options.disabled && !enabled),
        onClick: () => void perform(sync, sync.options.disabled ? "enable" : "pause"),
      },
      {
        label: "Delete",
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        collapsed: true,
        requiredPermission: "deleteEntities",
        disabled: maintenance || !!busy || !sync.options.disabled || active,
        onClick: () => void perform(sync, "delete"),
      },
    ];
  };
  return (
    <>
      <div className="flex justify-between gap-4 pb-6 flex-wrap">
        <div className="flex items-center gap-6 flex-wrap">
          <h1 className="text-3xl">Reverse Syncs</h1>
          <Input
            size="small"
            className="w-96 mt-0.5"
            placeholder="Filter by ID or name..."
            prefix={<Search className="w-3.5 h-3.5 text-textDisabled" />}
            allowClear
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {(router.query.modelId || router.query.destinationId) && (
            <Button
              size="small"
              icon={<XCircle className="w-4 h-4" />}
              onClick={() =>
                router.push({ pathname: `/${workspace.slugOrId}/reverse-syncs`, query: search ? { search } : {} })
              }
            >
              Clear entity filter
            </Button>
          )}
        </div>
        <WJitsuButton
          type="primary"
          size="large"
          icon={<Plus className="w-4 h-4" />}
          href="/reverse-syncs?id=new"
          requiredPermission="editEntities"
          disabled={!enabled || maintenance}
        >
          Connect model and destination
        </WJitsuButton>
      </div>
      <Failure error={error || syncs.error} />
      <Table<ReverseSyncView>
        size="small"
        rowKey="id"
        rowClassName={sync => (sync.options.disabled ? "opacity-50" : "")}
        className="border border-backgroundDark rounded-lg"
        loading={syncs.isLoading || !!busy}
        pagination={false}
        scroll={{ x: 1000 }}
        dataSource={data}
        locale={{ emptyText: <Empty description="No reverse syncs match this view" /> }}
        columns={[
          {
            title: "From",
            width: "30%",
            sorter: (a, b) => a.modelName.localeCompare(b.modelName),
            render: (_, s) => (
              <Link href={`/${workspace.slugOrId}/reverse-syncs?id=${s.id}`}>
                <ModelTitle modelId={s.fromId} title={s.modelName} />
              </Link>
            ),
          },
          {
            title: "To",
            width: "30%",
            sorter: (a, b) => a.destinationName.localeCompare(b.destinationName),
            render: (_, s) => (
              <Link href={`/${workspace.slugOrId}/reverse-syncs?id=${s.id}`}>
                <DestinationTitle destination={destinations.find(d => d.id === s.toId)} />
              </Link>
            ),
          },
          {
            title: (
              <div className="whitespace-nowrap">
                Last Status{" "}
                <Button
                  type="link"
                  size="small"
                  aria-label="Refresh statuses"
                  onClick={() => syncs.refetch()}
                  icon={<RefreshCw className={`w-3.5 h-3.5 ${syncs.isFetching ? "animate-spin" : ""}`} />}
                />
              </div>
            ),
            className: "text-right whitespace-nowrap",
            render: (_, s) => <ReverseTaskStatus task={s.latestTask} />,
          },
          {
            title: "Started (UTC)",
            className: "text-right whitespace-nowrap",
            render: (_, s) =>
              s.latestTask && (
                <Tooltip title={s.latestTask.started_at.toISOString()}>
                  <div>
                    {dayjs(s.latestTask.started_at).fromNow()}
                    <div className="text-xxs text-gray-500">
                      {dayjs(s.latestTask.started_at).utc().format("MMM DD, HH:mm:ss")}
                    </div>
                  </div>
                </Tooltip>
              ),
          },
          { title: <div className="text-right">Actions</div>, render: (_, s) => <ButtonGroup items={actions(s)} /> },
        ]}
      />
    </>
  );
}
