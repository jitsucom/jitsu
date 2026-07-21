import React, { useReducer } from "react";
import { Alert } from "antd";
import DOMPurify from "dompurify";
import { useRouter } from "next/router";
import { useBilling, UseBillingResult } from "./BillingProvider";
import { useEventsUsage, UseUsageRes } from "./use-events-usage";
import { useWorkspace } from "../../lib/context";
import { WJitsuButton } from "../JitsuButton/JitsuButton";
import { BillingBanner } from "../../lib/schema";

/**
 * In-app billing banners (JITSU-88), all sharing one design/rendering path:
 *
 * Server-provided banners come from the billing/settings response — the console
 * owns no copy or policy for those; the response describes each banner in full
 * (severity, dismissibility, HTML body, optional action button). The HTML comes
 * from our own billing server, but is still sanitized to a small
 * inline-formatting allowlist before rendering — a compromised or misbehaving
 * billing response must not be able to run script in the console origin.
 *
 * Two banners are still computed client-side (they replaced the old floating
 * workspace alerts) with explicit priority rules:
 *   - active partial throttle (`throttle=N` in featuresEnabled, N < 100): shown
 *     INSTEAD of any server banners — the applied throttle is ground truth,
 *     server state may lag it. At throttle=100 with server banners present, the
 *     server wins: a full block is exactly what the server's blocked banner
 *     describes, with better copy (blocked-count);
 *   - usage projected to exceed the free plan: shown only when there is nothing
 *     else to show.
 * TODO(JITSU-88 follow-up): move both to the billing server
 * (getWorkspaceBanners) — throttle state and stat_cache-based projection are
 * available there — and delete useEventsUsage from this component.
 *
 * Dismissals are client-side, keyed by workspace + the banner's stable `id` —
 * the id changes (e.g. new severity level or billing period) to re-show a
 * previously dismissed banner.
 */

const dismissKey = (workspaceId: string, bannerId: string) => `billing-banner-dismissed:${workspaceId}:${bannerId}`;

// Banner bodies are one-line messages: inline formatting and links only.
const sanitize = (html: string) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "u", "s", "code", "a", "br", "span"],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });

function usageIsAboutToExceed(billing: UseBillingResult, usage: UseUsageRes): boolean {
  return !!(
    billing.enabled &&
    billing.settings &&
    !usage.isLoading &&
    !usage.error &&
    usage.usage?.usagePercentage &&
    usage.usage?.usagePercentage < 1 &&
    billing.settings.planId === "free" &&
    usage.usage?.projectionByTheEndOfPeriod &&
    usage.usage?.projectionByTheEndOfPeriod > usage.usage.maxAllowedDestinatonEvents
  );
}

const BillingBannersInner: React.FC = () => {
  const billing = useBilling();
  const workspace = useWorkspace();
  const router = useRouter();
  const usage = useEventsUsage({ skipSubscribed: true });
  const [, forceRerender] = useReducer(x => x + 1, 0);

  const serverBanners = (billing.enabled && billing.settings?.banners) || [];
  // The billing page shows its own detailed alerts (BillingManager) — the
  // client-computed banners would duplicate them there. Server banners render
  // everywhere.
  const onBillingPage = router.pathname.endsWith("/settings/billing");

  let banners: BillingBanner[];
  if (usage.throttle && !onBillingPage && !(usage.throttle >= 100 && serverBanners.length > 0)) {
    banners = [
      {
        id: "client-throttle",
        severity: "error",
        dismissible: false,
        html: `Your workspace is throttled at <b>${usage.throttle}%</b> — part of your events are not delivered due to exceeding the free plan quota.`,
        action: { label: "See details", href: "/settings/billing" },
      },
    ];
  } else if (serverBanners.length > 0) {
    banners = serverBanners;
  } else if (usageIsAboutToExceed(billing, usage) && !onBillingPage) {
    banners = [
      {
        id: `client-projection:${usage.usage?.periodEnd?.toISOString() ?? "period"}`,
        severity: "warning",
        dismissible: true,
        html: "You are projected to exceed your monthly events. Please upgrade your plan to avoid service disruption.",
        action: { label: "Upgrade", href: "/settings/billing" },
      },
    ];
  } else {
    banners = [];
  }

  if (banners.length === 0) {
    return null;
  }

  return (
    <>
      {banners.map(banner => {
        const key = dismissKey(workspace.id, banner.id);
        if (banner.dismissible && typeof window !== "undefined" && window.localStorage.getItem(key)) {
          return null;
        }
        return (
          <Alert
            key={banner.id}
            className="rounded-none"
            type={banner.severity}
            showIcon
            closable={banner.dismissible}
            onClose={() => {
              if (typeof window !== "undefined") {
                window.localStorage.setItem(key, "1");
              }
              forceRerender();
            }}
            message={<span dangerouslySetInnerHTML={{ __html: sanitize(banner.html) }} />}
            action={
              banner.action ? (
                <WJitsuButton href={banner.action.href} type="primary" size="small">
                  {banner.action.label}
                </WJitsuButton>
              ) : undefined
            }
          />
        );
      })}
    </>
  );
};

export const BillingBanners: React.FC = () => {
  const billing = useBilling();
  // Inner component gate: useEventsUsage asserts billing is enabled + loaded.
  if (!billing.enabled || billing.loading) {
    return null;
  }
  return <BillingBannersInner />;
};
