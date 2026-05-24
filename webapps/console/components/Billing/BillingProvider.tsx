import { BillingSettings, noRestrictions } from "../../lib/schema";
import { useAppConfig, useUser, useWorkspace } from "../../lib/context";
import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from "react";
import { getLog } from "juava";
import { useJitsu } from "@jitsu/jitsu-react";
import { useEeApi } from "../../lib/eeApi";

export const BillingContext = createContext<BillingSettings | null | "disabled" | "loading">(null);
const log = getLog(`BillingProvider`);

export type UseBillingResult =
  | { loading: true; enabled: true; settings?: never }
  | { loading: false; enabled: false; settings?: never; error?: { message: string } }
  | { loading: false; enabled: true; settings: BillingSettings };

export function useBilling(): UseBillingResult {
  const ctx = useContext(BillingContext);
  const appConfig = useAppConfig();
  if (!appConfig.billingEnabled) {
    return { enabled: false, loading: false };
  } else if (ctx === null) {
    throw new Error(`useBilling() must be used inside <BillingProvider />`);
  } else if (ctx == "disabled") {
    return { enabled: false, loading: false };
  } else if (ctx == "loading") {
    return { enabled: true, loading: true };
  } else {
    return { enabled: true, loading: false, settings: ctx };
  }
}

export const parseBillingSettings = (settings: any): BillingSettings => {
  if (settings.noRestrictions) {
    return noRestrictions;
  }
  return BillingSettings.parse(settings.subscriptionStatus);
};

export const BillingProvider: React.FC<PropsWithChildren<{ enabled: boolean; sendAnalytics: boolean }>> = ({
  enabled,
  sendAnalytics,
  children,
}) => {
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null);
  const [error, setError] = useState();
  const workspace = useWorkspace();
  const user = useUser();
  const { analytics } = useJitsu();
  const { eeRpc } = useEeApi();
  const [refreshDate, setRefreshDate] = useState(new Date());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    eeRpc("billing/settings", { query: { workspaceId: workspace.id, email: user.email } })
      .then(parseBillingSettings)
      .then(setBillingSettings)
      .catch(setError)
      .finally();
  }, [enabled, workspace.id, user.email, refreshDate, eeRpc]);

  //refresh billing settings every 5 minutes
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const interval = setInterval(() => {
      setRefreshDate(new Date());
    }, 1000 * 60 * 5);
    return () => clearInterval(interval);
  }, [enabled]);

  /* eslint-disable react-hooks/exhaustive-deps  */
  //workspace.createdAt never changes for the same workspace
  useEffect(() => {
    if (!enabled || !sendAnalytics) {
      return;
    }
    if (workspace?.id && billingSettings?.planId) {
      analytics.group(workspace.id, {
        name: workspace.name,
        slug: workspace.slug ?? "",
        createdAt: workspace.createdAt.toISOString(),
        planId: billingSettings.planId,
      });
    }
  }, [enabled, sendAnalytics, analytics, workspace.id, workspace.name, workspace.slug, billingSettings?.planId]);
  /* eslint-enable */

  if (!enabled) {
    return <BillingContext.Provider value={"disabled"}>{children}</BillingContext.Provider>;
  } else if (error) {
    // The UI falls back to "Billing is disabled" because that's what the user
    // can act on, but log loudly so an operator can tell a real outage apart
    // from an intentionally-disabled workspace.
    log.atError().withCause(error).log(`Can't reach ee-api billing/settings — falling back to disabled UI`);
    return <BillingContext.Provider value={"disabled"}>{children}</BillingContext.Provider>;
  } else if (billingSettings) {
    return <BillingContext.Provider value={billingSettings}>{children}</BillingContext.Provider>;
  } else {
    return <BillingContext.Provider value={"loading"}>{children}</BillingContext.Provider>;
  }
};
