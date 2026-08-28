import { Alert } from "antd";
import { DataRetentionEditorLoader } from "../../../components/DataRentionEditor/DataRentionEditor";
import { BackupRetentionEditorLoader } from "../../../components/BackupRetentionEditor/BackupRetentionEditor";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { useBilling } from "../../../components/Billing/BillingProvider";
import { useAppConfig } from "../../../lib/context";

const DataRetentionEditorPage = () => {
  const appConfig = useAppConfig();
  const billing = useBilling();
  // The legacy retention-policy editor (queues, identity stitching, logs,
  // custom Mongo) is a "request a change, an admin applies it" flow sold on
  // select plans; it used to gate the whole page. Backups are self-serve for
  // every Jitsu Cloud workspace, so the page is always reachable now.
  const legacyEditorEnabled = billing.enabled && !!billing.settings?.dataRetentionEditorEnabled;
  return (
    <WorkspacePageLayout>
      <div>
        <h1 className="mb-6 text-4xl">Data Retention &amp; Backups</h1>
        {!appConfig.ee?.available ? (
          <Alert
            type="info"
            showIcon
            message="Event backups are a Jitsu Cloud feature"
            description="This deployment doesn't archive events. Configure a warehouse or file-storage destination if you need a raw copy of incoming events."
          />
        ) : (
          <div className="flex flex-col gap-6">
            <BackupRetentionEditorLoader />
            {legacyEditorEnabled && (
              <div>
                <h2 className="mb-4 text-2xl font-bold">Retention policy</h2>
                <DataRetentionEditorLoader />
              </div>
            )}
          </div>
        )}
      </div>
    </WorkspacePageLayout>
  );
};

export default DataRetentionEditorPage;
