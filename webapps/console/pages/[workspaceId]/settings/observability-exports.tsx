import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { ObservabilityExportsEditorLoader } from "../../../components/ObservabilityExportsEditor/ObservabilityExportsEditor";

const ObservabilityExportsPage = () => {
  return (
    <WorkspacePageLayout>
      <ObservabilityExportsEditorLoader />
    </WorkspacePageLayout>
  );
};

export default ObservabilityExportsPage;
