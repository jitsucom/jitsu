import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useAppConfig, useWorkspace } from "../../../lib/context";
import React from "react";
import { ErrorCard } from "../../../components/GlobalError/GlobalError";
import SyncEditorPage from "../../../components/SyncEditorPage/SyncEditorPage";
import { useConfigObjectLinks, useConfigObjectList } from "../../../lib/store";
import { z } from "zod";
import { ConfigurationObjectLinkDbModel } from "../../../prisma/schema";

const Loader = () => {
  const workspace = useWorkspace();
  const appconfig = useAppConfig();

  const links = useConfigObjectLinks({ withData: true });
  const services = useConfigObjectList("service");
  const destinations = useConfigObjectList("destination");

  if (!(appconfig.syncs.enabled || workspace.featuresEnabled.includes("syncs"))) {
    return (
      <ErrorCard
        title={"Feature is not enabled"}
        error={{ message: "'Sources Sync' feature is not enabled for current project." }}
        hideActions={true}
      />
    );
  }

  return <SyncEditorPage services={services} destinations={destinations} links={links as z.infer<typeof ConfigurationObjectLinkDbModel>[]} />;
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

RootComponent.displayName = "SyncEditorPage";

export default RootComponent;
