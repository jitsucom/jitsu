import React, { useCallback } from "react";
import { useWorkspace } from "../../../lib/context";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useBilling } from "../../../components/Billing/BillingProvider";
import { LoadingAnimation } from "../../../components/GlobalLoader/GlobalLoader";
import { UpgradeDialog } from "../../../components/Billing/UpgradeDialog";
import { DomainsEditor } from "../../../components/DomainsEditor/DomainsEditor";
import { useConfigApi } from "../../../lib/useApi";
import { WorkspaceDomain } from "../../../lib/schema";
import cuid from "cuid";
import { useConfigObjectList, useConfigObjectMutation } from "../../../lib/store";

const WorkspaceDomainsComponent: React.FC<any> = () => {
  const domainsRaw = useConfigObjectList("domain");
  const domains = domainsRaw.map((d: any) => d.name);
  const configApi = useConfigApi<WorkspaceDomain>("domain");
  const workspace = useWorkspace();
  const billing = useBilling();

  const onSaveMutation = useConfigObjectMutation("domain", async (newObject: any) => {
    await configApi.create(newObject);
  });

  const onDeleteMutation = useConfigObjectMutation("domain", async (obj: any) => {
    await configApi.del(obj.id);
  });

  const updateDomains = useCallback(
    async (newDomains: string[]) => {
      const toAdd = newDomains.filter(d => !domains.includes(d));
      const toDelete = domainsRaw.filter(d => !newDomains.includes(d.name));
      for (const domain of toAdd) {
        await onSaveMutation.mutateAsync({ id: cuid(), type: "domain", workspaceId: workspace.id, name: domain });
      }
      for (const domain of toDelete) {
        await onDeleteMutation.mutateAsync(domain);
      }
    },
    [domainsRaw, domains, onSaveMutation, workspace.id, onDeleteMutation]
  );

  if (billing.loading) {
    return <LoadingAnimation />;
  }
  if (billing.enabled && billing.settings?.planId === "free") {
    return <UpgradeDialog featureDescription={"Workspace Domains"} />;
  }

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-4xl grow">
        <div className="px-8 py-6 border border-textDisabled rounded-lg mt-6 mb-12">
          <div className="text-lg font-bold pb-6">Workspace Domains</div>
          <div className="text-text flex flex-col gap-2.5">
            <p>
              In this section you can manage domains for your workspace. Jitsu can issue SSL certificates for added
              domains and serve your data on them.
            </p>
            <p>Jitsu supports both regular domains and wildcard domains but with some differences:</p>
            <p>
              <b>Regular domain:</b> <code>data.example.com</code> – regular domain added on Workspace level is
              automatically applied to all workspace Sites
            </p>
            <p>
              <b>Wildcard domain:</b> <code>*.data.example.com</code> – Jitsu issues a SSL certificate for wildcard
              domain. For each workspace Site you need to add a specific subdomain. For example, if you set up{" "}
              <code>*.data.example.com</code> here, you can add domain <code>site1.data.example.com</code> for Site1 and{" "}
              <code>site2.data.example.com</code> for Site2. That will allow you to use the same SSL certificate for all
              subdomains and save time on issuing new certificates.
            </p>
          </div>
          <div className="mt-6">
            <DomainsEditor context={"workspace"} value={domains} onChange={updateDomains} />
          </div>
        </div>
      </div>
    </div>
  );
};

const WorkspaceDomains: React.FC<any> = () => {
  return (
    <WorkspacePageLayout doNotBlockIfUsageExceeded={true}>
      <WorkspaceDomainsComponent />
    </WorkspacePageLayout>
  );
};

export default WorkspaceDomains;
