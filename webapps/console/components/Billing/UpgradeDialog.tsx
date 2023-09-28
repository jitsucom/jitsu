import { Alert } from "antd";
import React from "react";
import { useBilling } from "./BillingProvider";
import { assertFalse, assertTrue } from "juava";
import { AlertCircle, Lock, Unlock } from "lucide-react";
import { WJitsuButton } from "../JitsuButton/JitsuButton";

function arrayJoin<T, S>(arr: T[], sep: S): (T | S)[] {
  const result: (T | S)[] = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(arr[i]);
    if (i < arr.length - 1) {
      result.push(sep);
    }
  }
  return result;
}

export const UpgradeDialog: React.FC<{ featureDescription: string; availableInPlans?: string[] }> = ({
  featureDescription,
  availableInPlans,
}) => {
  const billing = useBilling();
  assertTrue(billing.enabled, `Billing is not enabled. <UpgradeDialog /> should not be rendered.`);
  assertFalse(billing.loading, `Billing is loading. <UpgradeDialog /> should not be rendered.`);

  return (
    <div className="h-full w-full">
      <Alert
        message={
          <h3 className="text-2xl flex items-center space-x-2">
            <Lock className="w-6 h-6" /> <span>Upgrade required</span>
          </h3>
        }
        icon={<AlertCircle />}
        description={
          <div>
            <div className="text">
              You are currently subscribed to a{" "}
              <b className="uppercase">{billing.settings?.planName || billing.settings.planId}</b> plan. To use{" "}
              {featureDescription}, please upgrade to a{" "}
              {availableInPlans
                ? arrayJoin(
                    availableInPlans.map(p => (
                      <b key={p} className="bold uppercase">
                        {p}
                      </b>
                    )),
                    ", or "
                  )
                : "other"}{" "}
              plan.
            </div>
            <div className="mt-4">
              <WJitsuButton icon={<Unlock className="w-4 h-4" />} type="primary" href={`/settings/billing`}>
                Upgrade to a plan with {featureDescription}
              </WJitsuButton>
            </div>
          </div>
        }
        type="info"
      />
    </div>
  );
};
