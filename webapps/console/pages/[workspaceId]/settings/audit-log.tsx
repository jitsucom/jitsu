import React from "react";
import { Alert } from "antd";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace, useWorkspaceRole } from "../../../lib/context";
import { AuditLog } from "../../../components/AuditLog/AuditLog";

const AuditLogPage: React.FC = () => {
  const role = useWorkspaceRole();
  const workspace = useWorkspace();
  return (
    <WorkspacePageLayout>
      {role.manageUsers ? (
        <AuditLog workspaceId={workspace.id} workspaceSlug={workspace.slugOrId} />
      ) : (
        <Alert
          type="warning"
          showIcon
          message="Access denied"
          description="The audit log is visible to workspace owners only."
        />
      )}
    </WorkspacePageLayout>
  );
};

export default AuditLogPage;
