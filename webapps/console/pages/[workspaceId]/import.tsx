import React from "react";
import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { ImportWizard } from "../../components/ImportWizard/ImportWizard";

const ImportPage: React.FC = () => {
  return (
    <WorkspacePageLayout>
      <ImportWizard />
    </WorkspacePageLayout>
  );
};

export default ImportPage;
