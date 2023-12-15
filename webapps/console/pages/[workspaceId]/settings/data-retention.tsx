import { DataRetentionEditorLoader } from "../../../components/DataRentionEditor/DataRentionEditor";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";

const DataRetentionEditorPage = () => {
  return (
    <WorkspacePageLayout>
      <div>
        <h1 className="text-4xl mb-6">Data Retention</h1>
        <DataRetentionEditorLoader />
      </div>
    </WorkspacePageLayout>
  );
};

export default DataRetentionEditorPage;
