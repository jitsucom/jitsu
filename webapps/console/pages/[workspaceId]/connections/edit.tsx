import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useWorkspace } from "../../../lib/context";
import React, { useEffect, useState } from "react";
import { LoadingAnimation } from "../../../components/GlobalLoader/GlobalLoader";
import { GlobalError } from "../../../components/GlobalError/GlobalError";
import ConnectionEditorPage from "../../../components/ConnectionEditorPage/ConnectionEditorPage";
import { useStreamDestinationLinksQuery } from "../../../lib/queries";
import { useConfigApi } from "../../../lib/useApi";
import { FunctionConfig } from "../../../lib/schema";

type FunctionAPIResult = {
  functions: FunctionConfig[];
  isLoading: boolean;
  error: any;
};
const Loader = () => {
  const workspace = useWorkspace();
  const functionsApi = useConfigApi("function");
  const [functions, setFunctions] = useState<FunctionAPIResult>({
    functions: [],
    isLoading: true,
    error: null,
  });
  const result = useStreamDestinationLinksQuery(workspace.id, {
    cacheTime: 0,
    retry: false,
  });
  useEffect(() => {
    (async () => {
      try {
        setFunctions({ functions: [], isLoading: true, error: null });
        setFunctions({ functions: await functionsApi.list(), isLoading: false, error: null });
      } catch (e) {
        setFunctions({ functions: [], isLoading: false, error: e });
      }
    })();
  }, [functionsApi]);

  if (result.isLoading || functions.isLoading) {
    return <LoadingAnimation />;
  }
  if (result.error || functions.error) {
    return <GlobalError title={"Failed to load data from server"} error={result.error || functions.error} />;
  }
  const [streams, destinations, links] = result.data;
  return (
    <ConnectionEditorPage streams={streams} destinations={destinations} links={links} functions={functions.functions} />
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
