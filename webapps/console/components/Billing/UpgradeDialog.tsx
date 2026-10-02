import { Alert } from "antd";
import React from "react";
import { useBilling } from "./BillingProvider";
import { assertFalse } from "juava";
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
  // Billing may legitimately be unavailable in the browser while the feature is
  // still gated: appConfig.billingEnabled is `isEEAvailable() &&
  // isFirebaseEnabled()`, so an EE install using NextAuth or OIDC has no plan
  // here, yet the server enforces on isEEAvailable() alone (JITSU-228). This
  // used to assert, which would have turned a gated page into a crash for those
  // deployments. Degrade instead: say what is restricted, and drop the parts
  // that need a plan we cannot see.
  const planKnown = billing.enabled && !billing.loading && !!billing.settings;
  const planName = planKnown ? billing.settings?.planName || billing.settings?.planId : undefined;
  assertFalse(billing.enabled && billing.loading, `Billing is loading. <UpgradeDialog /> should not be rendered.`);

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
              {planName ? (
                <>
                  You are currently subscribed to a <b className="uppercase">{planName}</b> plan. To use{" "}
                </>
              ) : (
                <>To use </>
              )}
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
            {/* The billing page is only reachable when the browser has billing;
                without it, point at the person who can actually change the plan
                rather than a link that goes nowhere. */}
            {planKnown ? (
              <div className="mt-4">
                <WJitsuButton icon={<Unlock className="w-4 h-4" />} type="primary" href={`/settings/billing`}>
                  Upgrade to a plan with {featureDescription}
                </WJitsuButton>
              </div>
            ) : (
              <div className="mt-4 text-textLight">Contact your workspace administrator to change the plan.</div>
            )}
          </div>
        }
        type="info"
      />
    </div>
  );
};
