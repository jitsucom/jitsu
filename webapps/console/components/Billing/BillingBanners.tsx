import React, { useReducer } from "react";
import DOMPurify from "dompurify";
import { X } from "lucide-react";
import { useRouter } from "next/router";
import { useBilling, UseBillingResult } from "./BillingProvider";
import { useEventsUsage, UseUsageRes } from "./use-events-usage";
import { useWorkspace } from "../../lib/context";
import { WJitsuButton } from "../JitsuButton/JitsuButton";
import { BillingBanner } from "../../lib/schema";

/**
 * In-app billing banners (JITSU-88).
 *
 * The billing/settings response provides parametrized banner payloads
 * (severity, title, badge, body HTML with the quota progress bar, action,
 * closeable); this component owns the card template and renders them. HTML
 * fragments (`body`, `icon`, `action.subtitle`) are sanitized — a compromised
 * or misbehaving billing response must not run script — and action locations
 * are restricted to workspace-relative console paths.
 *
 * Two banners are still computed client-side (they replaced the old floating
 * workspace alerts) and share the same template, with explicit priority rules:
 *   - active partial throttle (`throttle=N` in featuresEnabled, N < 100): shown
 *     INSTEAD of any server banners — the applied throttle is ground truth,
 *     server state may lag it. At throttle=100 with server banners present, the
 *     server wins: a full block is exactly what the server's blocked banner
 *     describes, with better copy (blocked-count);
 *   - usage projected to exceed the free plan: shown only when there is nothing
 *     else to show.
 * TODO(JITSU-123): move both to the billing server (getWorkspaceBanners) and
 * delete useEventsUsage from here.
 *
 * Dismissals are client-side, keyed by workspace + the banner's stable `id` —
 * the id changes (e.g. new severity level or billing period) to re-show a
 * previously dismissed banner.
 */

const dismissKey = (workspaceId: string, bannerId: string) => `billing-banner-dismissed:${workspaceId}:${bannerId}`;

// localStorage can throw in restricted contexts (privacy mode, blocked
// third-party storage) — a failed read/write must degrade to "not dismissed",
// never take down layout rendering.
const safeStorageGet = (key: string): string | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
};
const safeStorageSet = (key: string, value: string): void => {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, value);
    }
  } catch {}
};

// Banner HTML fragments are copy + the progress-bar widget: structural markup
// and inline styles, no script vectors.
const sanitize = (html: string) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["div", "span", "p", "a", "b", "i", "em", "strong", "u", "s", "code", "br"],
    ALLOWED_ATTR: ["href", "style"],
  });

const Html: React.FC<{ html: string; className?: string }> = ({ html, className }) => (
  <span className={className} dangerouslySetInnerHTML={{ __html: sanitize(html) }} />
);

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

const themes: Record<BillingBanner["severity"], { card: string; iconBox: string; badge: string }> = {
  info: {
    card: "bg-blue-50 border-blue-200 border-l-blue-600",
    iconBox: "bg-blue-100 text-blue-600",
    badge: "text-blue-700 bg-blue-100 border-blue-200",
  },
  warning: {
    card: "bg-amber-50 border-amber-200 border-l-amber-600",
    iconBox: "bg-amber-100 text-amber-600",
    badge: "text-amber-700 bg-amber-100 border-amber-200",
  },
  error: {
    card: "bg-red-50 border-red-200 border-l-red-600",
    iconBox: "bg-red-100 text-red-600",
    badge: "text-red-700 bg-red-100 border-red-200",
  },
};

/** The banner card template (design: JITSU-88 mock) filled from a BillingBanner payload. */
const BannerCard: React.FC<{ banner: BillingBanner; onClose?: () => void }> = ({ banner, onClose }) => {
  const t = themes[banner.severity];
  // Only workspace-relative console paths — a server bug/compromise must not
  // be able to send users off-origin (WJitsuButton prefixes the workspace).
  const action =
    banner.action && banner.action.location.startsWith("/") && !banner.action.location.startsWith("//")
      ? banner.action
      : undefined;
  return (
    <div className={`flex items-start gap-4 rounded-xl border border-l-4 py-5 px-6 ${t.card}`}>
      <div className={`flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center ${t.iconBox}`}>
        {banner.icon ? <Html html={banner.icon} /> : <span className="text-xl font-extrabold">!</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-lg font-bold text-neutral-900">{banner.title}</span>
          <span className={`text-xs font-bold tracking-wide rounded-full border px-2.5 py-0.5 ${t.badge}`}>
            {banner.badge}
          </span>
        </div>
        <Html className="block mt-0.5 text-sm text-neutral-600 leading-normal" html={banner.body} />
      </div>
      {action && (
        <div className="flex-shrink-0 ml-2 flex flex-col items-end gap-2.5">
          <WJitsuButton href={action.location} type="primary" size="large">
            {action.text}
          </WJitsuButton>
          {action.subtitle && <Html className="text-[12.5px] text-gray-500" html={action.subtitle} />}
        </div>
      )}
      {banner.closeable && onClose && (
        <button
          className="flex-shrink-0 self-start -mt-2 -mr-3 ml-1 p-1 rounded text-neutral-400 hover:text-neutral-600 hover:bg-black/5"
          aria-label="Dismiss"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

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
        title: "Workspace throttled",
        badge: `${usage.throttle}% THROTTLED`,
        body: `Part of your events are not being delivered — your workspace is throttled at <b>${usage.throttle}%</b> due to exceeding the free plan quota.`,
        action: { text: "See details", location: "/settings/billing" },
        closeable: false,
      },
    ];
  } else if (serverBanners.length > 0) {
    banners = serverBanners;
  } else if (usageIsAboutToExceed(billing, usage) && !onBillingPage) {
    banners = [
      {
        id: `client-projection:${usage.usage?.periodEnd?.toISOString() ?? "period"}`,
        severity: "warning",
        title: "Projected to exceed your quota",
        badge: "PROJECTION",
        body: "At the current pace you'll exceed your monthly events quota before the period ends. Upgrade your plan to avoid service disruption.",
        action: { text: "Upgrade", location: "/settings/billing" },
        closeable: true,
      },
    ];
  } else {
    banners = [];
  }

  const isDismissed = (banner: BillingBanner) =>
    banner.closeable && !!safeStorageGet(dismissKey(workspace.id, banner.id));
  const visibleBanners = banners.filter(banner => !isDismissed(banner));
  if (visibleBanners.length === 0) {
    return null;
  }

  return (
    <>
      {visibleBanners.map(banner => (
        <div key={banner.id} className="mt-4">
          <BannerCard
            banner={banner}
            onClose={
              banner.closeable
                ? () => {
                    safeStorageSet(dismissKey(workspace.id, banner.id), "1");
                    forceRerender();
                  }
                : undefined
            }
          />
        </div>
      ))}
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
