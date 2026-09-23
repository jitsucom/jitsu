import React from "react";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { ReverseTasksList } from "../../../components/ReverseETL/TasksList";
import { useRouter } from "next/router";
export default function ReverseTasksPage() {
  const router = useRouter();
  React.useEffect(() => {
    if (router.isReady && router.query.taskId)
      void router.replace({ pathname: `/${router.query.workspaceId}/reverse-syncs/logs`, query: router.query });
  }, [router.isReady, router.query, router]);
  return (
    <WorkspacePageLayout>
      <ReverseTasksList />
    </WorkspacePageLayout>
  );
}
