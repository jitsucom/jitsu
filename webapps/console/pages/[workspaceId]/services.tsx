import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { ConfigEditor, ConfigEditorProps } from "../../components/ConfigObjectEditor/ConfigEditor";
import { ServiceConfig } from "../../lib/schema";
import { useAppConfig, useWorkspace } from "../../lib/context";
import { useRouter } from "next/router";
import { getLog, hash as jhash, randomId, rpc } from "juava";
import React from "react";
import { Modal } from "antd";
import { serialization, useURLPersistedState } from "../../lib/ui";
import { getServiceIcon, ServicesCatalog } from "../../components/ServicesCatalog/ServicesCatalog";
import { SourceType } from "../api/sources";
import hash from "stable-hash";
import { ServiceEditor } from "../../components/ServiceEditor/ServiceEditor";
import { ErrorCard } from "../../components/GlobalError/GlobalError";
import { syncError } from "../../lib/shared/errors";
import { ObjectTitle } from "../../components/ObjectTitle/ObjectTitle";
import omit from "lodash/omit";

const log = getLog("services");

const Services: React.FC<any> = () => {
  const router = useRouter();
  console.log("router", router.pathname);
  return (
    <WorkspacePageLayout>
      <ServicesList />
    </WorkspacePageLayout>
  );
};

export const ServiceTitle: React.FC<{
  service?: ServiceConfig;
  size?: "small" | "default" | "large";
  title?: (d: ServiceConfig) => string | React.ReactNode;
}> = ({ service, title = d => d.name, size = "default" }) => {
  return (
    <ObjectTitle
      icon={
        <img
          alt={service?.package}
          src={`/api/sources/logo?type=${service?.protocol}&package=${encodeURIComponent(service?.package ?? "")}`}
        />
      }
      size={size}
      title={service ? title(service) : "Unknown service"}
    />
  );
};

const ServicesList: React.FC<{}> = () => {
  const workspace = useWorkspace();

  const [showCatalog, setShowCatalog] = useURLPersistedState<boolean>("showCatalog", {
    defaultVal: false,
    type: serialization.bool,
  });
  const router = useRouter();
  const appconfig = useAppConfig();

  if (!(appconfig.syncs.enabled || workspace.featuresEnabled.includes("syncs"))) {
    return (
      <ErrorCard
        title={"Feature is not enabled"}
        error={{ message: "'Sources Sync' feature is not enabled for current project." }}
        hideActions={true}
      />
    );
  }

  const config: ConfigEditorProps<ServiceConfig, SourceType> = {
    listColumns: [
      {
        title: "Package",
        render: (s: ServiceConfig) => <span className={"font-semibold"}>{`${s?.package}:${s?.version}`}</span>,
      },
    ],
    objectType: ServiceConfig,
    fields: {
      type: { constant: "service" },
      workspaceId: { constant: workspace.id },
      protocol: { hidden: true },
      package: { hidden: true },
    },
    noun: "service",
    type: "service",
    explanation: "Services are used to connect to external systems",
    icon: s => (
      <img
        alt={s?.package}
        src={`/api/sources/logo?type=${s?.protocol}&package=${encodeURIComponent(s?.package ?? "")}`}
      />
    ),
    editorComponent: () => ServiceEditor,
    loadMeta: async (obj?: ServiceConfig) => {
      let packageType = "";
      let packageId = "";
      if (obj) {
        packageType = obj.protocol;
        packageId = obj.package;
      } else {
        packageType = router.query["packageType"] as string;
        packageId = router.query["packageId"] as string;
      }
      const rawVersions = await rpc(
        `/api/sources/versions?type=${packageType}&package=${encodeURIComponent(packageId)}`
      );
      const versions = rawVersions.versions.filter((v: any) => v.isRelease).map((v: any) => v.name);
      const sourceType = await rpc(`/api/sources/${packageType}/${encodeURIComponent(packageId)}`);

      return {
        ...sourceType,
        versions,
      };
    },
    newObject: meta => {
      if (meta) {
        return {
          name: meta.meta.name,
          protocol: meta.packageType as ServiceConfig["protocol"],
          package: meta.packageId,
          version: meta.versions[0],
        };
      } else {
        throw new Error("Failed to load service metadata");
      }
    },
    testConnectionEnabled: (obj: ServiceConfig) => {
      return true;
    },
    onTest: async obj => {
      console.log("Testing service", obj, typeof obj);
      try {
        //hash object to avoid sending credentials to the server
        const queryId = randomId();
        const h = jhash("md5", hash(obj.credentials));

        const storageKey = `${workspace.id}_${obj.id}_${h}_${queryId}`;
        const res = await rpc(`/api/${workspace.id}/sources/check?storageKey=${storageKey}`, {
          method: "POST",
          body: omit(obj, "testConnectionError"),
        });
        if (res.error) {
          return res;
        }
        for (let i = 0; i < 60; i++) {
          const res = await rpc(`/api/${workspace.id}/sources/check?storageKey=${storageKey}`);
          if (!res.pending) {
            return res;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        return { ok: false, error: "Connection test timeout." };
      } catch (error) {
        return syncError(log, "Failed to test service", error);
      }
    },
    addAction: () => {
      setShowCatalog(true);
    },
    editorTitle: (obj: ServiceConfig, isNew: boolean, meta) => {
      if (!meta) {
        throw new Error("Failed to load service metadata");
      }
      const verb = isNew ? "New" : "Edit";
      return (
        <div className="flex items-center">
          <div className="h-12 w-12 mr-4">{getServiceIcon(meta)}</div>
          {verb} service: {meta.meta.name}
        </div>
      );
    },
    subtitle: (obj: ServiceConfig, isNew: boolean, meta) => {
      return `${obj.package || meta!.packageId}`;
    },
  };
  return (
    <>
      <Modal
        bodyStyle={{
          overflowY: "auto",
          maxHeight: "calc(100vh - 200px)",
          minHeight: "400px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
        open={showCatalog}
        style={{ minWidth: 1000 }}
        width="90vw"
        onCancel={() => setShowCatalog(false)}
        footer={null}
      >
        <ServicesCatalog
          onClick={async (packageType, packageId) => {
            await setShowCatalog(false).then(() =>
              router.push(
                `/${workspace.id}/services?id=new&packageType=${packageType}&packageId=${encodeURIComponent(packageId)}`
              )
            );
          }}
        />
      </Modal>
      <ConfigEditor {...(config as any)} />
    </>
  );
};

export default Services;
