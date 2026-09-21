import React from "react";
import { Alert } from "antd";
import { useRouter } from "next/router";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import { SyncEditor } from "../../../components/ReverseETL/SyncEditor";
import { ReverseSyncsList } from "../../../components/ReverseETL/SyncsList";
import { Failure, ReverseNotice, useReverseSyncs } from "../../../components/ReverseETL/shared";

export default function ReverseSyncsPage() {
  return (
    <WorkspacePageLayout>
      <ReverseSyncs />
    </WorkspacePageLayout>
  );
}
function ReverseSyncs() {
  const workspace = useWorkspace();
  const router = useRouter();
  const syncs = useReverseSyncs();
  const selected = syncs.data?.find(s => s.id === router.query.id);
  return (
    <>
      <ReverseNotice enabled={workspace.featuresEnabled.includes("reverse-etl")} />
      {router.query.id ? (
        <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-6 min-w-0">
          <Failure error={syncs.error} />
          {router.query.id === "new" ? (
            <SyncEditor key="new" reload={syncs.refetch} />
          ) : selected ? (
            <SyncEditor key={selected.id} sync={selected} reload={syncs.refetch} />
          ) : (
            <Alert
              type={syncs.isLoading ? "info" : "error"}
              title={syncs.isLoading ? "Loading sync…" : "Sync not found"}
            />
          )}
        </div>
      ) : (
        <ReverseSyncsList />
      )}
    </>
  );
}
