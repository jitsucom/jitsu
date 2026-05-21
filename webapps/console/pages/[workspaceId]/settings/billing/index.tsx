import { WorkspacePageLayout } from "../../../../components/PageLayout/WorkspacePageLayout";
import { useBilling } from "../../../../components/Billing/BillingProvider";
import { Alert, Skeleton } from "antd";
import { ChevronLeft } from "lucide-react";
import React from "react";
import Link from "next/link";
import { BillingManager } from "../../../../components/Billing/BillingManager";
import { WJitsuButton } from "../../../../components/JitsuButton/JitsuButton";

const BillingPage: React.FC<{}> = () => {
  return (
    <WorkspacePageLayout doNotBlockIfUsageExceeded={true}>
      <div>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-4xl">Plan & Billing</h1>
          <WJitsuButton href={`/settings`} size="large" type="primary" icon={<ChevronLeft className="w-5 h-5" />}>
            Back to settings
          </WJitsuButton>
        </div>
      </div>
      <div>
        <BillingComponent />
      </div>
    </WorkspacePageLayout>
  );
};

const BillingComponent: React.FC<{}> = () => {
  const billing = useBilling();
  if (!billing.enabled) {
    return (
      <div>
        <Alert
          showIcon
          message="Billing is disabled"
          description={
            <>Billing is disabled for this workspace. Please contact your workspace admin to enable billing.</>
          }
        />
      </div>
    );
  } else if (billing.loading) {
    return <Skeleton active={true} />;
  } else if (billing.settings.planId === "$admin") {
    return (
      <div>
        <Alert
          showIcon
          message="Please, contact your workspace admin to change your plan."
          description={
            <>
              You're plan is managed by Jitsu Sales team. Please, contact us at <b>support@jitsu.com</b> to make any
              changes
            </>
          }
        />
      </div>
    );
  } else if (billing.settings.billingParent) {
    const parent = billing.settings.billingParent;
    return (
      <div>
        <Alert
          showIcon
          type="info"
          message="Billing is managed by a parent workspace"
          description={
            <>
              This workspace bills under <b>{parent.name}</b>. Its plan, invoices and usage are managed there.{" "}
              <Link className="text-primary" href={`/${parent.slug ?? parent.id}/settings/billing`}>
                Open {parent.name}'s billing page
              </Link>
            </>
          }
        />
      </div>
    );
  }

  return <BillingManager />;
};

export default BillingPage;
