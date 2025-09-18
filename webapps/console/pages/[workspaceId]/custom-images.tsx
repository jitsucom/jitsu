import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { ConfigEditor, ConfigEditorProps } from "../../components/ConfigObjectEditor/ConfigEditor";
import { ConnectorImageConfig } from "../../lib/schema";
import { useAppConfig, useWorkspace } from "../../lib/context";
import React from "react";
import { SourceType } from "../api/sources";
import { ErrorCard } from "../../components/GlobalError/GlobalError";
import { ServerCog } from "lucide-react";
import { FaDocker } from "react-icons/fa";
import { Htmlizer } from "../../components/Htmlizer/Htmlizer";
import { rpc } from "juava";
import { UpgradeDialog } from "../../components/Billing/UpgradeDialog";
import { useBilling } from "../../components/Billing/BillingProvider";
import { LoadingAnimation } from "../../components/GlobalLoader/GlobalLoader";

const CustomImages: React.FC<any> = () => {
  return (
    <WorkspacePageLayout>
      <CustomImagesList />
    </WorkspacePageLayout>
  );
};

const CustomImagesList: React.FC<{}> = () => {
  const workspace = useWorkspace();
  const appconfig = useAppConfig();
  const billing = useBilling();

  if (billing.loading) {
    return <LoadingAnimation />;
  }
  if (billing.enabled && billing.settings?.planId === "free") {
    return <UpgradeDialog featureDescription={"Custom Images"} />;
  }

  if (!(appconfig.syncs.enabled || workspace.featuresEnabled.includes("syncs"))) {
    return (
      <ErrorCard
        title={"Feature is not enabled"}
        error={{ message: "'Sources Sync' feature is not enabled for current project." }}
        hideActions={true}
      />
    );
  }

  const config: ConfigEditorProps<ConnectorImageConfig, SourceType> = {
    listColumns: [
      {
        title: "Package",
        render: (s: ConnectorImageConfig) => <span className={"font-semibold"}>{`${s.package}:${s.version}`}</span>,
      },
    ],
    objectType: ConnectorImageConfig,
    fields: {
      type: { constant: "custom-image" },
      workspaceId: { constant: workspace.id },
      cloneId: { hidden: true },
      package: {
        documentation: (
          <Htmlizer>
            {
              "Docker image name. Images can also include a registry hostname, e.g.: <code>fictional.registry.example/imagename</code>, and possibly a port number as well."
            }
          </Htmlizer>
        ),
      },
      version: {
        documentation: "Docker image tag",
      },
    },
    noun: "custom image",
    type: "custom-image",
    explanation: "Custom connector images that can be used to setup Service connector",
    icon: () => <FaDocker className="w-full h-full" />,
    testConnectionEnabled: () => true,
    testButtonLabel: "Check Image",
    onTest: async obj => {
      try {
        const firstRes = await rpc(
          `/api/${workspace.id}/sources/spec?package=${obj.package}&version=${obj.version}&force=true`
        );
        if (firstRes.ok) {
          return { ok: true };
        } else if (firstRes.error) {
          return { ok: false, error: `Cannot load specs for ${obj.package}:${obj.version}: ${firstRes.error}` };
        } else {
          for (let i = 0; i < 60; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const resp = await rpc(`/api/${workspace.id}/sources/spec?package=${obj.package}&version=${obj.version}`);
            if (!resp.pending) {
              if (resp.error) {
                return { ok: false, error: `Cannot load specs for ${obj.package}:${obj.version}: ${resp.error}` };
              } else {
                return { ok: true };
              }
            }
          }
          return { ok: false, error: `Cannot load specs for ${obj.package}:${obj.version}: Timeout` };
        }
      } catch (error: any) {
        return { ok: false, error: `Cannot load specs for ${obj.package}:${obj.version}: ${error.message}` };
      }
    },
    editorTitle: (_: ConnectorImageConfig, isNew: boolean) => {
      const verb = isNew ? "New" : "Edit";
      return (
        <div className="flex items-center">
          <div className="h-12 w-12 mr-4">
            <FaDocker className="w-full h-full" />
          </div>
          {verb} custom image
        </div>
      );
    },
    actions: [
      {
        icon: <ServerCog className="w-full h-full" />,
        title: "Setup Connector",
        collapsed: false,
        link: s =>
          `/services?id=new&packageType=airbyte&packageId=${encodeURIComponent(s.package)}&version=${encodeURIComponent(
            s.version
          )}`,
      },
    ],
  };
  return (
    <>
      <ConfigEditor {...(config as any)} />
    </>
  );
};

export default CustomImages;
