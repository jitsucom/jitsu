import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import React from "react";
import { Alert } from "antd";
import ConnectionEditorPage from "../../../components/ConnectionEditorPage/ConnectionEditorPage";
import { FunctionConfig } from "../../../lib/schema";
import { useConfigObjectLinks, useConfigObjectList } from "../../../lib/store";
import { z } from "zod";
import { ConfigurationObjectLinkDbModel } from "../../../prisma/schema";
import { getCoreDestinationTypeNonStrict } from "../../../lib/schema/destinations";

type FunctionAPIResult = {
  functions: FunctionConfig[];
  isLoading: boolean;
  error: any;
};
const Loader = () => {
  const links = useConfigObjectLinks({ withData: true });
  const streams = useConfigObjectList("stream");
  const destinations = useConfigObjectList("destination").filter(
    d => !getCoreDestinationTypeNonStrict(d.destinationType)?.reverseEtlOnly
  );
  const functions = useConfigObjectList("function").filter(f => f.kind !== "profile");
  if (!destinations.length) {
    return (
      <Alert
        type="info"
        message="Add an event destination before creating a connection. Microsoft Ads is available in Reverse ETL syncs."
      />
    );
  }
  return (
    <ConnectionEditorPage
      streams={streams}
      destinations={destinations}
      links={links as z.infer<typeof ConfigurationObjectLinkDbModel>[]}
      functions={functions}
    />
  );
};

const RootComponent: React.FC = () => {
  return (
    <WorkspacePageLayout>
      <div className="flex justify-center">
        <Loader />
      </div>
    </WorkspacePageLayout>
  );
};

RootComponent.displayName = "ConnectionEditorPage";

export default RootComponent;
