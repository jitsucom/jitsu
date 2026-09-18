import React, { useState } from "react";
import { Alert, Button, Descriptions, Input, Modal, Table } from "antd";
import { useRouter } from "next/router";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { z } from "zod";
import { ReverseTask } from "../../lib/reverse-etl";
import { useAppConfig, useWorkspace, useWorkspaceRole } from "../../lib/context";
import { EditorTitle } from "../ConfigObjectEditor/EditorTitle";
import { Failure, Panel, RunStatus, useReverseSyncs } from "./shared";

const resultSchema = z.object({
  tasks: z.array(ReverseTask),
  logs: z.array(z.object({ id: z.string(), timestamp: z.coerce.date(), level: z.string(), message: z.string() })),
});
export function ReverseRuns({ syncId, compact = false }: { syncId?: string; compact?: boolean }) {
  const workspace = useWorkspace();
  const router = useRouter();
  const role = useWorkspaceRole();
  const maintenance = useAppConfig().maintenance?.active;
  const syncs = useReverseSyncs();
  const taskId = !compact && typeof router.query.taskId === "string" ? router.query.taskId : undefined;
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const tasks = useQuery({
    queryKey: ["reverse-etl-tasks", workspace.id, syncId, taskId],
    queryFn: async () =>
      resultSchema.parse(
        await rpc(`/api/${workspace.id}/reverse-etl/tasks`, {
          query: { ...(syncId ? { syncId } : {}), ...(taskId ? { taskId } : {}) },
        })
      ),
    refetchInterval: 5000,
  });
  const task = taskId ? tasks.data?.tasks[0] : undefined;
  const syncName = (id: string) => syncs.data?.find(s => s.id === id)?.options.name || id;
  const cancel = async () => {
    if (!task) return;
    setBusy(true);
    setError(undefined);
    try {
      await rpc(`/api/${workspace.id}/reverse-etl/sync`, {
        method: "POST",
        query: { syncId: task.sync_id },
        body: { action: "cancel", taskId: task.task_id },
      });
      await tasks.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!compact && (
        <EditorTitle
          title={taskId ? "Run details" : "Reverse ETL logs"}
          subtitle={
            <p className="text-textLight mb-6">
              {taskId
                ? "An execution attempt of a durable reverse-sync run."
                : "Recent execution attempts across all reverse syncs."}
            </p>
          }
          onBack={() => router.push(`/${workspace.slugOrId}/reverse-syncs${taskId ? "/tasks" : ""}`)}
        />
      )}
      <Failure error={error || tasks.error} />
      {taskId ? (
        task ? (
          <>
            <Panel title={syncName(task.sync_id)}>
              <div className="flex justify-between items-center mb-5">
                <RunStatus status={task.status} />
                <Button
                  danger
                  loading={busy}
                  disabled={!role.editEntities || !!maintenance || !["RUNNING", "WAITING"].includes(task.status)}
                  onClick={() =>
                    Modal.confirm({
                      title: "Cancel this attempt?",
                      content:
                        "Google requests already in flight may still finish. Accepted changes and recovery evidence are kept.",
                      okText: "Cancel attempt",
                      okButtonProps: { danger: true },
                      onOk: cancel,
                    })
                  }
                >
                  Cancel attempt
                </Button>
              </div>
              <Descriptions
                column={1}
                size="small"
                items={[
                  { key: "id", label: "Attempt ID", children: <code className="break-all">{task.task_id}</code> },
                  {
                    key: "sync",
                    label: "Sync",
                    children: (
                      <Link href={`/${workspace.slugOrId}/reverse-syncs?id=${task.sync_id}`}>
                        {syncName(task.sync_id)}
                      </Link>
                    ),
                  },
                  { key: "start", label: "Started", children: task.started_at.toLocaleString() },
                  { key: "updated", label: "Last update", children: task.updated_at.toLocaleString() },
                  { key: "progress", label: "Progress", children: task.description || "—" },
                ]}
              />
            </Panel>
            {task.status === "WAITING" && (
              <Alert
                className="mb-5"
                type="warning"
                title="Waiting for Google"
                description="Submitted changes are still processing. Status refreshes continue automatically while the sync is enabled."
              />
            )}
            {task.status === "RESUMED" && (
              <Alert
                className="mb-5"
                type="info"
                title="Continued in a later attempt"
                description="A later attempt is handling these changes. See this sync’s Runs tab for the latest status."
              />
            )}
            {task.error && <Alert className="mb-5" type="error" title="Run stopped" description={task.error} />}
            <Panel
              title="Logs"
              description="Core lifecycle messages only. Source rows, identifiers and provider recovery payloads are not displayed."
            >
              <Input.Search
                placeholder="Filter log messages"
                allowClear
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="mb-4"
              />
              <Table
                size="small"
                rowKey="id"
                scroll={{ x: 600 }}
                pagination={{ pageSize: 25 }}
                dataSource={tasks.data?.logs.filter(l => l.message.toLowerCase().includes(search.toLowerCase()))}
                columns={[
                  { title: "Time", dataIndex: "timestamp", width: 200, render: (d: Date) => d.toLocaleString() },
                  { title: "Level", dataIndex: "level", width: 90 },
                  {
                    title: "Message",
                    dataIndex: "message",
                    render: t => <span className="font-mono break-all">{t}</span>,
                  },
                ]}
              />
            </Panel>
          </>
        ) : (
          <Alert
            type={tasks.isLoading ? "info" : "error"}
            title={tasks.isLoading ? "Loading attempt…" : "Attempt not found"}
          />
        )
      ) : (
        <Table<ReverseTask>
          rowKey="task_id"
          loading={tasks.isLoading}
          dataSource={tasks.data?.tasks ?? []}
          scroll={{ x: 720 }}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: "No reverse-sync runs yet" }}
          columns={[
            {
              title: "Sync",
              dataIndex: "sync_id",
              render: (id: string) => (
                <Link href={`/${workspace.slugOrId}/reverse-syncs?id=${id}`}>{syncName(id)}</Link>
              ),
            },
            { title: "Started", dataIndex: "started_at", render: (d: Date) => d.toLocaleString() },
            { title: "Status", dataIndex: "status", render: (status: string) => <RunStatus status={status} /> },
            { title: "Progress", dataIndex: "description" },
            {
              title: "",
              render: (_, t) => (
                <Link href={`/${workspace.slugOrId}/reverse-syncs/tasks?taskId=${t.task_id}`}>View logs</Link>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
