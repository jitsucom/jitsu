import React, { useReducer } from "react";
import { Alert } from "antd";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useBilling } from "./BillingProvider";
import { useWorkspace } from "../../lib/context";
import { WJitsuButton } from "../JitsuButton/JitsuButton";
import { QuotaStatus } from "../../lib/schema";

dayjs.extend(utc);

/**
 * In-app usage-quota banner (JITSU-88). Renders the `quotaStatus` computed by
 * ee-api (billing/settings) — the console owns none of the thresholds or the
 * copy decision, it only renders what `level` says:
 *
 *   warning80 / warning90 — dismissible (per workspace + level + period)
 *   warning95            — persistent warning
 *   blocked              — persistent error (delivery paused)
 */

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const formatPeriodEnd = (iso: string) => dayjs(iso).utc().format("MMMM D, YYYY");

const DISMISSIBLE = new Set<QuotaStatus["level"]>(["warning80", "warning90"]);

function dismissKey(workspaceId: string, q: QuotaStatus): string {
  // Keyed by level + period so an escalation (80→90) or a new billing period
  // re-shows the banner even after a prior dismissal.
  return `quota-banner-dismissed:${workspaceId}:${q.level}:${q.periodEnd}`;
}

export const QuotaBanner: React.FC = () => {
  const billing = useBilling();
  const workspace = useWorkspace();
  const [, forceRerender] = useReducer(x => x + 1, 0);

  const quota = billing.enabled && !billing.loading ? billing.settings.quotaStatus : undefined;
  if (!quota || quota.level === "none") {
    return null;
  }

  const key = dismissKey(workspace.id, quota);
  if (DISMISSIBLE.has(quota.level) && typeof window !== "undefined" && window.localStorage.getItem(key)) {
    return null;
  }
  const onClose = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, "1");
    }
    forceRerender();
  };

  const billingHref = "/settings/billing";
  const upgrade = (label: string) => (
    <WJitsuButton href={billingHref} type="primary" size="small">
      {label}
    </WJitsuButton>
  );

  const usageText = `${fmt(quota.usage)} / ${fmt(quota.quota)}`;
  const period = formatPeriodEnd(quota.periodEnd);

  switch (quota.level) {
    case "warning80":
      return (
        <Alert
          className="rounded-none"
          type="info"
          showIcon
          closable
          onClose={onClose}
          message={
            <span>
              ⚠️ You've used <b>{quota.percent}%</b> of your events quota ({usageText}). Period resets {period}.
            </span>
          }
          action={upgrade("View usage")}
        />
      );
    case "warning90":
      return (
        <Alert
          className="rounded-none"
          type="warning"
          showIcon
          closable
          onClose={onClose}
          message={
            <span>
              ⚠️ <b>{quota.percent}% of quota used.</b> Event delivery pauses at 105% ({usageText}). Upgrade to avoid
              interruption.
            </span>
          }
          action={upgrade("Upgrade now")}
        />
      );
    case "warning95":
      return (
        <Alert
          className="rounded-none"
          type="warning"
          showIcon
          message={
            <span>
              🚨 <b>{quota.percent}% of quota used — delivery will pause at 105%.</b> Upgrade now to keep events flowing
              ({usageText}).
            </span>
          }
          action={upgrade("Upgrade")}
        />
      );
    case "blocked":
      return (
        <Alert
          className="rounded-none"
          type="error"
          showIcon
          message={
            <span>
              ⛔ <b>Event delivery paused.</b> You've exceeded your quota ({usageText}).
              {quota.blockedCount > 0 ? ` ${fmt(quota.blockedCount)} events not delivered so far.` : ""} Delivery
              resumes {period}.
            </span>
          }
          action={upgrade("Upgrade to resume")}
        />
      );
    default:
      return null;
  }
};
