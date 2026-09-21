import React from "react";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { ReverseRuns } from "../../../components/ReverseETL/Runs";
import { useRouter } from "next/router";
export default function ReverseTasksPage() {
  const router = useRouter();
  React.useEffect(() => {
    if (router.isReady && router.query.taskId)
      void router.replace({ pathname: `/${router.query.workspaceId}/reverse-syncs/logs`, query: router.query });
  }, [router.isReady, router.query, router]);
  return (
    <WorkspacePageLayout>
      <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-6 min-w-0">
        <ReverseRuns />
      </div>
    </WorkspacePageLayout>
  );
}
