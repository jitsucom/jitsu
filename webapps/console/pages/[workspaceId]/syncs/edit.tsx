import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useAppConfig, useWorkspace } from "../../../lib/context";
import React from "react";
import { LoadingAnimation } from "../../../components/GlobalLoader/GlobalLoader";
import { ErrorCard, GlobalError } from "../../../components/GlobalError/GlobalError";
import { useLinksQuery } from "../../../lib/queries";
import SyncEditorPage from "../../../components/SyncEditorPage/SyncEditorPage";
import { Redirect } from "../../../components/Redirect/Redirect";
import { getCoreDestinationTypeNonStrict } from "../../../lib/schema/destinations";

const Loader = () => {
  const workspace = useWorkspace();
  const appconfig = useAppConfig();

  const result = useLinksQuery(workspace.id, "sync", {
    cacheTime: 0,
    retry: false,
  });
  if (!(appconfig.syncs.enabled || workspace.featuresEnabled.includes("syncs"))) {
    return (
      <ErrorCard
        title={"Feature is not enabled"}
        error={{ message: "'Sources Sync' feature is not enabled for current project." }}
        hideActions={true}
      />
    );
  }

  if (result.isLoading) {
    return <LoadingAnimation />;
  }
  if (result.error) {
    return <GlobalError title={"Failed to load data from server"} error={result.error} />;
  }
  const [services, destinations, links] = result.data;
  const bulkerDsts = destinations.filter(d => getCoreDestinationTypeNonStrict(d.destinationType)?.usesBulker);
  //protection from faulty redirects to this page
  if (services.length === 0) {
    return <Redirect href={`/${workspace.slugOrId}/services`} />;
  } else if (bulkerDsts.length === 0) {
    return <Redirect href={`/${workspace.slugOrId}/destinations`} />;
  }
  return <SyncEditorPage services={services} destinations={bulkerDsts} links={links} />;
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
