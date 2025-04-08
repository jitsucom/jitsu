import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { useTitle } from "../../lib/ui";
import { branding } from "../../lib/branding";
import { DataView } from "../../components/DataView/DataView";

const DataViewPage: React.FC<any> = () => {
  useTitle(`${branding.productName} » Live Events`);

  return (
    <WorkspacePageLayout>
      <div className="flex flex-col">
        <h1 className="text-3xl mb-4">Live Events</h1>
        <DataView />
      </div>
    </WorkspacePageLayout>
  );
};

export default DataViewPage;
