import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { useTitle } from "../../lib/ui";
import { branding } from "../../lib/branding";
import React from "react";
import SQLViewer from "../../components/SQLViewer/SQLViewer";
import { useRouter } from "next/router";
import { useApi } from "../../lib/useApi";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { LoadingAnimation } from "../../components/GlobalLoader/GlobalLoader";
import { ErrorCard } from "../../components/GlobalError/GlobalError";
import Link from "next/link";
import ClickhouseIcon from "../../lib/schema/icons/clickhouse";
import { ProvisionDatabaseButton } from "../../components/ProvisionDatabaseButton/ProvisionDatabaseButton";
import LucideIcon from "../../components/Icons/LucideIcon";

function removeDoubleSlashes(url: string) {}

function concatUrl(base: string, s: string): string {
  while (s.startsWith("/")) {
    s = s.substring(1);
  }
  while (base.endsWith("/")) {
    base = base.substring(0, base.length - 1);
  }
  return `${base}/${s}`;
}

const AvailableDestinationsList: React.FC<any> = () => {
  const workspace = useWorkspace();
  const appConfig = useAppConfig();
  const { data, error } = useApi(`/api/${workspace.id}/sql/query`);
  if (data) {
    return (
      <div className="w-3/4 mx-auto">
        <h1 className="text-2xl font-bold mb-4">Start SQL Query Editor</h1>
        <div className="font-light text-textLight font-sm">
          You can run SQL queries against following destinations. We support ClickHouse destinations connected via HTTPS
          interface, including{" "}
          <Link
            className="underline"
            href={appConfig.docsUrl ? concatUrl(appConfig.docsUrl, "/features/provisioned-warehouse") : "/"}
          >
            provision ClickHouse database
          </Link>
        </div>
        {Object.entries(data).length == 0 && (
          <>
            <div className="flex flex-col items-center">
              <LucideIcon name={"inbox"} className="h-16 w-16 my-6 text-neutral-200" />
              <div className="text text-textLight mb-6">You don't any destinations available for SQL</div>
            </div>
          </>
        )}
        <div className="flex flex-col space-y-4 mt-4">
          {Object.entries(data)
            .filter(([destinationId, destination]) => !!(destination as any).supportQueries)
            .map(([destinationId, destination]) => (
              <Link
                className="block border border-textDisabled rounded px-4 py-4 shadow hover:border-primaryDark hover:shadow-primaryLighter flex justify-between items-center hover:text-textPrimary group"
                key={workspace.slug || workspace.id}
                href={`/${workspace.slug || workspace.id}/sql?destinationId=${destinationId}`}
              >
                <div className="flex items-center space-x-4">
                  <div className="w-8 h-w-8">
                    <ClickhouseIcon />
                  </div>
                  <div>{(destination as any).name}</div>
                </div>
                <div className="invisible group-hover:visible">
                  <LucideIcon name={"arrow-right"} className="text-primary" />
                </div>
              </Link>
            ))}
        </div>
        {appConfig.ee?.available && <ProvisionDatabaseButton />}
      </div>
    );
  } else if (error) {
    return <ErrorCard error={error} />;
  }
  return <LoadingAnimation />;
};

const DataViewPage: React.FC<any> = () => {
  useTitle(`${branding.productName} : Query Data`);
  const router = useRouter();
  const destinationId = router.query.destinationId as string | undefined;

  if (!destinationId) {
    return (
      <WorkspacePageLayout>
        <AvailableDestinationsList />
      </WorkspacePageLayout>
    );
  }
  return (
    <WorkspacePageLayout className={"h-screen"} fullscreen={true}>
      <div className="flex flex-col h-full pt-12">
        <div className="w-full flex-auto overflow-auto">
          <SQLViewer destinationId={destinationId} />
        </div>
      </div>
    </WorkspacePageLayout>
  );
};

export default DataViewPage;
