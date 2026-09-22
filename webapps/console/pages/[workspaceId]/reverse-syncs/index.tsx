import React from "react";
import { Alert, Button, Empty, Table, Tag } from "antd";
import { useRouter } from "next/router";
import Link from "next/link";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useAppConfig, useWorkspace, useWorkspaceRole } from "../../../lib/context";
import { ReverseSyncView } from "../../../lib/reverse-etl";
import { SyncWizard } from "../../../components/ReverseETL/SyncWizard";
import { SyncDetail } from "../../../components/ReverseETL/SyncDetail";
import { Failure, ReverseNotice, RunStatus, useReverseSyncs } from "../../../components/ReverseETL/shared";

export default function ReverseSyncsPage() {
  return (
    <WorkspacePageLayout>
      <ReverseSyncs />
    </WorkspacePageLayout>
  );
}
function ReverseSyncs() {
  const workspace = useWorkspace();
  const role = useWorkspaceRole();
  const router = useRouter();
  const maintenance = useAppConfig().maintenance?.active;
  const syncs = useReverseSyncs();
  const enabled = workspace.featuresEnabled.includes("reverse-etl");
  const selected = syncs.data?.find(s => s.id === router.query.id);
  const data = (syncs.data ?? []).filter(
    s =>
      (!router.query.modelId || s.fromId === router.query.modelId) &&
      (!router.query.destinationId || s.toId === router.query.destinationId)
  );
  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-6 min-w-0">
      <ReverseNotice enabled={enabled} />
      <Failure error={syncs.error} />
      {router.query.id === "new" ? (
        <SyncWizard />
      ) : router.query.id ? (
        selected ? (
          <SyncDetail key={selected.id} sync={selected} reload={syncs.refetch} />
        ) : (
          <Alert
            type={syncs.isLoading ? "info" : "error"}
            title={syncs.isLoading ? "Loading sync…" : "Sync not found"}
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl text-textDark">Reverse syncs</h1>
              <p className="text-textLight mt-2">Activate warehouse audiences in your advertising destinations.</p>
            </div>
            <Button
              type="primary"
              disabled={!enabled || !role.editEntities || !!maintenance}
              onClick={() => router.push(`/${workspace.slugOrId}/reverse-syncs?id=new`)}
            >
              New reverse sync
            </Button>
          </div>
          <Table<ReverseSyncView>
            rowKey="id"
            loading={syncs.isLoading}
            dataSource={data}
            scroll={{ x: 900 }}
            locale={{
              emptyText: (
                <Empty description="Create a model, connect Google Ads, then configure your first reverse sync." />
              ),
            }}
            columns={[
              {
                title: "Sync",
                render: (_, s) => (
                  <div>
                    <Link className="font-medium" href={`/${workspace.slugOrId}/reverse-syncs?id=${s.id}`}>
                      {s.options.name || s.modelName}
                    </Link>
                    <p className="text-textLight text-xs mt-1">
                      {s.modelName} → {s.destinationName}
                    </p>
                  </div>
                ),
              },
              {
                title: "Enablement",
                render: (_, s) => (
                  <Tag>{s.setupPending ? "Setup incomplete" : s.options.disabled ? "Paused" : "Enabled"}</Tag>
                ),
              },
              { title: "Mode", render: (_, s) => (s.options.mode === "mirror" ? "Mirror" : "Add / remove") },
              {
                title: "Schedule",
                render: (_, s) => (
                  <span>
                    {s.options.schedule || "Manual only"}
                    <small className="block text-textLight">{s.options.timezone || "Etc/UTC"}</small>
                  </span>
                ),
              },
              { title: "Last attempt", render: (_, s) => <RunStatus status={s.latestTask?.status} /> },
            ]}
          />
        </>
      )}
    </div>
  );
}
