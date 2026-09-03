import { Alert } from "antd";
import { useRouter } from "next/router";
import Link from "next/link";
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
        <div className="w-full max-w-4xl">
          <EditorTitle
            title="Data Retention & Backups"
            subtitle={
              <div className="text-textLight mb-9 max-w-[40rem] text-[15px] leading-[1.55]">
                <div>
                  Jitsu keeps event data only as long as each stage needs it, then drops it. One thing is yours to
                  decide: how long backups stay restorable.
                </div>
                <div className="mt-2 text-sm">
                  <Link
                    className="font-semibold"
                    href="https://docs.jitsu.com/features/event-backups"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Read the docs
                  </Link>
                </div>
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
            <div className="flex flex-col gap-10">
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
