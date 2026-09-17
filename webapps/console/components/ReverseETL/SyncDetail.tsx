import React, { useState } from "react";
import { Alert, Button, Descriptions, Form, Input, Modal, Table, Tabs, Tag, message } from "antd";
import { useRouter } from "next/router";
import { rpc } from "juava";
import { ReverseSyncView } from "../../lib/reverse-etl";
import { useAppConfig, useWorkspace, useWorkspaceRole } from "../../lib/context";
import { EditorTitle } from "../ConfigObjectEditor/EditorTitle";
import FieldListEditorLayout from "../FieldListEditorLayout/FieldListEditorLayout";
import { Failure, Panel, RunStatus } from "./shared";
import { ReverseRuns } from "./Runs";

export function SyncDetail({ sync, reload }: { sync: ReverseSyncView; reload: () => Promise<unknown> }) {
  const workspace = useWorkspace();
  const role = useWorkspaceRole();
  const router = useRouter();
  const maintenance = useAppConfig().maintenance?.active;
  const enabled = workspace.featuresEnabled.includes("reverse-etl");
  const canEdit = role.editEntities && !maintenance;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [tab, setTab] = useState("overview");
  const active = ["RUNNING", "WAITING"].includes(sync.latestTask?.status ?? "");
  const endpoint = `/api/${workspace.id}/reverse-etl/sync?syncId=${encodeURIComponent(sync.id)}`;
  const action = async (method: "POST" | "PUT" | "DELETE", body?: unknown) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await rpc(endpoint, { method, ...(body ? { body } : {}) });
      await reload();
      if (method === "DELETE") await router.push(`/${workspace.slugOrId}/reverse-syncs`);
      else if (result.status === "pending")
        message.info("Google has not confirmed the audience yet. Check again using this same setup.");
      else message.success(result.status ?? "Sync updated");
      return result;
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <EditorTitle
        title={sync.options.name || `${sync.modelName} → ${sync.destinationName}`}
        subtitle={
          <div className="flex flex-wrap items-center gap-2 mb-6 text-textLight">
            <Tag>{sync.setupPending ? "Setup incomplete" : sync.options.disabled ? "Paused" : "Enabled"}</Tag>
            <Tag color="blue">{sync.options.mode === "mirror" ? "Mirror" : "Add / remove"}</Tag>
            <a href={`/${workspace.slugOrId}/models?id=${sync.fromId}`}>{sync.modelName}</a>
            <span>→</span>
            <a href={`/${workspace.slugOrId}/destinations?id=${sync.toId}`}>{sync.destinationName}</a>
          </div>
        }
        onBack={() => router.push(`/${workspace.slugOrId}/reverse-syncs`)}
      />
      <div className="flex flex-wrap gap-3 mb-5">
        <Button
          type="primary"
          loading={busy}
          disabled={!canEdit || !enabled || sync.options.disabled || sync.setupPending || active}
          onClick={() => action("POST", { action: "run" })}
        >
          {sync.latestTask?.status === "FAILED" ? "Retry run" : "Run now"}
        </Button>
        <Button
          disabled={!canEdit || busy || sync.setupPending || (!enabled && sync.options.disabled)}
          onClick={() =>
            sync.options.disabled
              ? action("PUT", { disabled: false })
              : Modal.confirm({
                  title: "Pause this sync?",
                  content:
                    "This stops new runs and automatic recovery. In-flight Google requests may still finish. Cancel an active attempt separately if needed.",
                  okText: "Pause sync",
                  onOk: () => action("PUT", { disabled: true }),
                })
          }
        >
          {sync.options.disabled ? "Enable sync" : "Pause sync"}
        </Button>
        <Button onClick={() => setTab("configuration")}>Configuration</Button>
      </div>
      <Failure error={error} />
      {sync.setupPending && (
        <Panel
          title="Complete managed-audience setup"
          description="The disabled sync and its creation request are saved. Repeating this action checks the same Google request; it never creates a second audience after an uncertain response."
        >
          <Alert
            type="info"
            title="Create a new, exclusively managed Customer Match audience"
            description="540-day membership with a 30-day unchanged-member refresh. After Google confirms the audience, enable the sync and run it when ready."
            className="mb-4"
          />
          <Button
            type="primary"
            loading={busy}
            disabled={!enabled || !canEdit}
            onClick={() => action("POST", { action: "setup" })}
          >
            Create audience / check setup status
          </Button>
        </Panel>
      )}
      {!sync.setupPending && sync.options.disabled && (
        <Alert
          className="mb-5"
          type="info"
          title="This sync is paused"
          description="New runs and automatic recovery are stopped. Enable it to resume. In-flight requests may still complete."
        />
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "overview",
            label: "Overview",
            children: (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-5">
                  <Panel title="Last attempt">
                    <RunStatus status={sync.latestTask?.status} />
                    <p className="mt-4">{sync.latestTask?.description || "No run has started yet."}</p>
                    {sync.latestTask?.error && (
                      <Alert type="error" title="Run stopped" description={sync.latestTask.error} />
                    )}
                    {sync.latestTask && (
                      <a href={`/${workspace.slugOrId}/reverse-syncs/tasks?taskId=${sync.latestTask.task_id}`}>
                        View attempt and logs →
                      </a>
                    )}
                  </Panel>
                  <Panel title="Delivery behavior">
                    <Descriptions
                      column={1}
                      size="small"
                      items={[
                        {
                          key: "audience",
                          label: "Audience",
                          children:
                            sync.audienceName || String(sync.options.streamOptions.audienceId ?? "Awaiting setup"),
                        },
                        { key: "schedule", label: "Schedule", children: sync.options.schedule || "Manual only" },
                        { key: "tz", label: "Timezone", children: sync.options.timezone || "Etc/UTC" },
                        { key: "phase", label: "Saved run phase", children: sync.phase || "No saved run" },
                        { key: "error", label: "Permanent row errors", children: "Fail immediately" },
                      ]}
                    />
                  </Panel>
                </div>
                {sync.options.mode === "mirror" && (
                  <Alert
                    type="info"
                    title="Snapshot-based mirroring"
                    description="Each full model result becomes the desired audience. The runner adds new members, removes missing members and refreshes unchanged members after 30 days. A failed or incomplete extraction does not become the new baseline."
                  />
                )}
                {sync.latestTask?.status === "WAITING" && (
                  <Alert
                    className="mt-4"
                    type="warning"
                    title="Google is processing submitted changes"
                    description="Syncctl will start a recovery attempt automatically while this sync stays enabled. Do not create another run or reset state."
                  />
                )}
              </>
            ),
          },
          { key: "runs", label: "Runs", children: <ReverseRuns syncId={sync.id} compact /> },
          {
            key: "configuration",
            label: "Configuration",
            children: (
              <>
                <Panel
                  title="Schedule & display name"
                  description="These settings do not change the delivery revision."
                >
                  <Form
                    key={JSON.stringify([sync.options.name, sync.options.schedule, sync.options.timezone])}
                    layout="vertical"
                    initialValues={{
                      name: sync.options.name || sync.modelName,
                      schedule: sync.options.schedule || "",
                      timezone: sync.options.timezone || "Etc/UTC",
                    }}
                    disabled={!canEdit || !enabled || busy}
                    onFinish={values => action("PUT", values)}
                  >
                    <FieldListEditorLayout
                      items={[
                        {
                          name: "Name",
                          component: (
                            <Form.Item name="name" rules={[{ required: true, whitespace: true }]}>
                              <Input aria-label="Sync name" maxLength={200} />
                            </Form.Item>
                          ),
                        },
                        {
                          name: "Schedule",
                          documentation:
                            "Five-field cron, or empty for manual only. Removing the schedule still allows manual runs and automatic recovery.",
                          component: (
                            <Form.Item name="schedule">
                              <Input aria-label="Cron schedule" placeholder="0 0 * * *" />
                            </Form.Item>
                          ),
                        },
                        {
                          name: "Timezone",
                          component: (
                            <Form.Item name="timezone" rules={[{ required: true }]}>
                              <Input aria-label="Timezone" />
                            </Form.Item>
                          ),
                        },
                      ]}
                    />
                    <Button className="mt-4" type="primary" htmlType="submit" loading={busy}>
                      Save settings
                    </Button>
                  </Form>
                </Panel>
                <Panel
                  title="Mapping"
                  description="Model, account, audience and mappings are fixed for this sync. Create a separate sync for a different delivery configuration."
                >
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="field"
                    dataSource={Object.entries(sync.options.mapping).map(([field, column]) => ({ field, column }))}
                    columns={[
                      { title: "Destination field", dataIndex: "field" },
                      { title: "Model column", dataIndex: "column" },
                    ]}
                  />
                </Panel>
                <Panel
                  title="Delete sync"
                  description="Pause and cancel any active or waiting attempts first. Deleting the sync keeps the Google audience and durable delivery evidence; it does not remove audience members."
                >
                  <Button
                    danger
                    disabled={!role.deleteEntities || !!maintenance || busy || !sync.options.disabled || active}
                    onClick={() =>
                      Modal.confirm({
                        title: "Delete this reverse sync?",
                        content: "The Google audience and saved delivery evidence will be kept.",
                        okText: "Delete sync",
                        okButtonProps: { danger: true },
                        onOk: () => action("DELETE"),
                      })
                    }
                  >
                    Delete sync
                  </Button>
                </Panel>
              </>
            ),
          },
        ]}
      />
    </>
  );
}
