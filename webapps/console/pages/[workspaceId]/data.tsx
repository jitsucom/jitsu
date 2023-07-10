import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { useTitle } from "../../lib/ui";
import { branding } from "../../lib/branding";
import React from "react";
import { DataView } from "../../components/DataView/DataView";

const DataViewPage: React.FC<any> = () => {
  useTitle(`${branding.productName} » Live Events`);

  return (
    <WorkspacePageLayout>
      <div className="flex flex-col">
        <div className="flex mt-4 mb-4">
          <h1 className="text-3xl">Live Events</h1>
        </div>
        <div className="w-full">
          <DataView />
        </div>
      </div>
    </WorkspacePageLayout>
  );
};

export default DataViewPage;
