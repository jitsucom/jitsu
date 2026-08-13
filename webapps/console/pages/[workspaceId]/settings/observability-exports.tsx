import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { ObservabilityExportsEditorLoader } from "../../../components/ObservabilityExportsEditor/ObservabilityExportsEditor";

const ObservabilityExportsPage = () => {
  return (
    <WorkspacePageLayout>
      <div>
        <h1 className="text-4xl mb-6">Observability exports</h1>
        <ObservabilityExportsEditorLoader />
      </div>
    </WorkspacePageLayout>
  );
};

export default ObservabilityExportsPage;
