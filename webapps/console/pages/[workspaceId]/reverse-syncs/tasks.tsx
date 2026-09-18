import React from "react";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { ReverseRuns } from "../../../components/ReverseETL/Runs";
export default function ReverseTasksPage() {
  return (
    <WorkspacePageLayout>
      <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-6 min-w-0">
        <ReverseRuns />
      </div>
    </WorkspacePageLayout>
  );
}
