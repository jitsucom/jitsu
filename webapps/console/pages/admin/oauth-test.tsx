import { useQuery } from "@tanstack/react-query";
import { getErrorMessage, getLog, rpc } from "juava";
import type { OauthDecorator } from "../../lib/server/oauth/services";
import { ErrorCard } from "../../components/GlobalError/GlobalError";
import { useState } from "react";
import { Button, Input, Select } from "antd";

import { AppConfig } from "../../lib/schema";
import Nango from "@nangohq/frontend";
import { CodeBlock } from "../../components/CodeBlock/CodeBlock";
import LucideIcon from "../../components/Icons/LucideIcon";

type OauthService = Omit<Required<OauthDecorator>, "merge">;

const CatalogView: React.FC<{ connectors: OauthService[]; appConfig: AppConfig }> = ({ connectors, appConfig }) => {
  const [selectedPackage, setSelectedPackage] = useState(connectors[0].packageId);
  const [serviceId, setServiceId] = useState("");
  const [adding, setAdding] = useState(false);
  const [nangoError, setNangoError] = useState<string | undefined>();
  const [retrieving, setRetrieving] = useState(false);
  const [retrievingError, setRetrievingError] = useState<string | undefined>();
  const [retrievedForService, setRetrieveForService] = useState("");
  const [credentials, setCredentials] = useState<any>();
  const [integrationId, setIntegrationId] = useState<string>("");

  if (!appConfig.nango) {
    return <div className="w-screen h-screen flex justify-center items-center">Oauth integration is not enabled</div>;
  }

  return (
    <div className="w-screen h-screen overflow-auto p-12">
      <div className="mx-auto" style={{ maxWidth: "1000px" }}>
        <h1 className={"text-3xl mb-6"}>Add new connection</h1>
        <div className="p-6 border border-textDisabled rounded-lg">
          <h2 className="text-lg font-bold mb-2">Select connector</h2>
          <Select
            value={selectedPackage}
            onSelect={setSelectedPackage}
            options={connectors.map(c => ({ value: c.packageId, label: c.packageId }))}
          />
          <h2 className="text-lg font-bold mb-2 mt-6">Service id</h2>
          <Input onChange={e => setServiceId(e.target.value)} value={serviceId} />
          <Button
            disabled={serviceId === ""}
            loading={adding}
            className="mt-6"
            type="primary"
            onClick={() => {
              const connector = connectors.find(c => c.packageId === selectedPackage)!;
              const nango = new Nango({ publicKey: appConfig.nango!.publicKey, host: appConfig.nango!.host });
              setAdding(true);
              nango
                .auth(connector.nangoIntegrationId, `sync-source.${serviceId}`)
                .then(result => {
                  window.location.reload();
                })
                .catch(err => {
                  setNangoError(getErrorMessage(err));
                  getLog().atError().log("Failed to add oauth connection", err);
                })
                .finally(() => setAdding(false));
            }}
          >
            Add
          </Button>
          {nangoError && <div className="mt-6 text-red-500">{nangoError}</div>}
        </div>
        <h1 className={"text-3xl my-6"}>Get credentials</h1>
        <div className="p-6 border border-textDisabled rounded-lg">
          <h2 className="text-lg font-bold mb-2">Service id</h2>
          <Input onChange={e => setRetrieveForService(e.target.value)} value={retrievedForService} />
          <h2 className="text-lg font-bold my-2">Integration id (optional)</h2>
          <Input onChange={e => setIntegrationId(e.target.value)} value={integrationId} />
          <Button
            disabled={retrievedForService === ""}
            loading={retrieving}
            className="my-6"
            type="primary"
            onClick={async () => {
              setRetrieving(true);
              try {
                const result = await rpc(
                  `/api/oauth/service?serviceId=${retrievedForService}` +
                    (integrationId ? `&integrationId=${integrationId}` : ""),
                  { method: "POST" }
                );
                setCredentials(result);
                setRetrievingError(undefined);
              } catch (err) {
                setRetrievingError(getErrorMessage(err));
                setCredentials(undefined);
                getLog().atError().log("Failed to get credentials", err);
              } finally {
                setRetrieving(false);
              }
            }}
          >
            Get
          </Button>
          {retrievingError && <div className="mt-6 text-red-500">{retrievingError}</div>}
          {credentials && <CodeBlock>{JSON.stringify(credentials, null, 2)}</CodeBlock>}
        </div>
      </div>
    </div>
  );
};

const OauthTest: React.FC<{}> = () => {
  const { data, isLoading, error } = useQuery(
    ["oauth-catalog"],
    async () => {
      const catalog = (await rpc(`/api/oauth/catalog`)) as { decorators: OauthService[] };
      const appConfig = (await rpc(`/api/app-config`)) as AppConfig;
      return { catalog: catalog.decorators, appConfig };
    },
    { cacheTime: 0, retry: false }
  );

  if (isLoading) {
    return (
      <div className="w-screen h-screen flex justify-center items-center">
        <LucideIcon name={"loader-2"} className="h-16 w-16 animate-spin" />
      </div>
    );
  } else if (error) {
    return (
      <div className="w-screen h-screen flex justify-center items-center">
        <ErrorCard error={error} />
      </div>
    );
  }

  return <CatalogView connectors={data!.catalog} appConfig={data!.appConfig} />;
};

export default OauthTest;
