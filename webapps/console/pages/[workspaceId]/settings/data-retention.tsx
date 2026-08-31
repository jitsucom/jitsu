import { Alert } from "antd";
import { useRouter } from "next/router";
import { DataRetentionEditorLoader } from "../../../components/DataRentionEditor/DataRentionEditor";
import { BackupRetentionEditorLoader } from "../../../components/BackupRetentionEditor/BackupRetentionEditor";
import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import { EditorTitle } from "../../../components/ConfigObjectEditor/EditorTitle";
import { useBilling } from "../../../components/Billing/BillingProvider";
import { useAppConfig, useWorkspace } from "../../../lib/context";

const DataRetentionEditorPage = () => {
  const appConfig = useAppConfig();
  const billing = useBilling();
  const router = useRouter();
  const workspace = useWorkspace();
  // The legacy retention-policy editor (queues, identity stitching, logs,
  // custom Mongo) is a "request a change, an admin applies it" flow sold on
  // select plans; it used to gate the whole page. Backups are self-serve for
  // every Jitsu Cloud workspace, so the page is always reachable now.
  const legacyEditorEnabled = billing.enabled && !!billing.settings?.dataRetentionEditorEnabled;
  return (
    <WorkspacePageLayout>
      <div className="flex justify-center">
        <div className="max-w-4xl grow">
          <EditorTitle
            title="Data Retention & Backups"
            subtitle={
              <div className="text-textLight mb-6 max-w-[40rem] text-sm leading-[22px]">
                Jitsu keeps your event data only as long as each stage of the pipeline needs it. Here is how long data
                lives at every step — and where you decide: <span className="text-text font-medium">backups</span>, the
                raw copy of your events that Jitsu can restore from if a destination ever fails or loses data. Once data
                has aged out of every stage, Jitsu no longer holds a copy of it.
              </div>
            }
            onBack={() => router.push(`/${workspace.slugOrId}/settings`)}
          />
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
      </div>
    </WorkspacePageLayout>
  );
};

export default DataRetentionEditorPage;
