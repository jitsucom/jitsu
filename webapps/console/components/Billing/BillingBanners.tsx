import React, { ReactNode, useReducer } from "react";
import DOMPurify from "dompurify";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useBilling, UseBillingResult } from "./BillingProvider";
import { useEventsUsage, UseUsageRes } from "./use-events-usage";
import { useWorkspace } from "../../lib/context";

/**
 * In-app billing banners (JITSU-88).
 *
 * Server-provided banners come from the billing/settings response as complete
 * banner-card HTML (layout, icon, progress bar, action button — inline styles,
 * see billing repo's renderBannerCard). The console sanitizes and renders them
 * verbatim and only owns the dismiss control. Sanitization allows structural
 * markup + inline styles but still strips script vectors, and drops any link
 * that is not a workspace-relative console path — a compromised or misbehaving
 * billing response must not run script or send users off-origin.
 *
 * Two banners are still computed client-side (they replaced the old floating
 * workspace alerts), rendered via a local card component matching the same
 * design, with explicit priority rules:
 *   - active partial throttle (`throttle=N` in featuresEnabled, N < 100): shown
 *     INSTEAD of any server banners — the applied throttle is ground truth,
 *     server state may lag it. At throttle=100 with server banners present, the
 *     server wins: a full block is exactly what the server's blocked banner
 *     describes, with better copy (blocked-count);
 *   - usage projected to exceed the free plan: shown only when there is nothing
 *     else to show.
 * TODO(JITSU-123): move both to the billing server (getWorkspaceBanners) and
 * delete useEventsUsage + the local card component from here.
 *
 * Dismissals are client-side, keyed by workspace + the banner's stable `id` —
 * the id changes (e.g. new severity level or billing period) to re-show a
 * previously dismissed banner.
 */

const dismissKey = (workspaceId: string, bannerId: string) => `billing-banner-dismissed:${workspaceId}:${bannerId}`;

// The server sends a full card: structural tags + inline styles are required.
// DOMPurify still strips all script vectors (tags, event handlers, javascript:
// URLs); the hook below additionally restricts links to console paths.
let dompurifyHookInstalled = false;
const sanitize = (html: string) => {
  if (!dompurifyHookInstalled && typeof window !== "undefined") {
    DOMPurify.addHook("afterSanitizeAttributes", node => {
      if (node.tagName === "A") {
        const href = node.getAttribute("href") || "";
        if (!href.startsWith("/") || href.startsWith("//")) {
          node.removeAttribute("href");
        }
      }
    });
    dompurifyHookInstalled = true;
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["div", "span", "p", "a", "b", "i", "em", "strong", "u", "s", "code", "br", "button"],
    ALLOWED_ATTR: ["href", "style", "type", "aria-label"],
    // keeps data-banner-dismiss — the delegation target for the dismiss ✕
    ALLOW_DATA_ATTR: true,
  });
};

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

const cardThemes = {
  warning: { card: "bg-amber-50 border-amber-200 border-l-amber-600", iconBox: "bg-amber-100 text-amber-600" },
  error: { card: "bg-red-50 border-red-200 border-l-red-600", iconBox: "bg-red-100 text-red-600" },
} as const;

/**
 * Local card matching the server-side renderBannerCard design, used only for
 * the client-computed banners until they move server-side (JITSU-123).
 */
const ClientBannerCard: React.FC<{
  theme: keyof typeof cardThemes;
  title: string;
  badge: string;
  body: ReactNode;
  actionLabel: string;
  actionHref: string;
  onDismiss?: () => void;
}> = ({ theme, title, badge, body, actionLabel, actionHref, onDismiss }) => {
  const t = cardThemes[theme];
  return (
    <div className={`flex items-start gap-4 rounded-xl border border-l-4 py-5 px-6 ${t.card}`}>
      <div className={`flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center ${t.iconBox}`}>
        <span className="text-xl font-extrabold">!</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-lg font-bold text-neutral-900">{title}</span>
          <span
            className={`text-xs font-bold tracking-wide rounded-full border px-2.5 py-0.5 ${
              theme === "error"
                ? "text-red-700 bg-red-100 border-red-200"
                : "text-amber-700 bg-amber-100 border-amber-200"
            }`}
          >
            {badge}
          </span>
        </div>
        <div className="mt-1.5 text-sm text-neutral-600 leading-relaxed">{body}</div>
      </div>
      <div className="flex-shrink-0 ml-2">
        <Link
          href={actionHref}
          className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg whitespace-nowrap"
        >
          {actionLabel}
        </Link>
      </div>
      {onDismiss && (
        <button
          className="flex-shrink-0 self-start -mt-2 -mr-3 ml-1 p-1 rounded text-neutral-400 hover:text-neutral-600 hover:bg-black/5"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

type DisplayBanner = { id: string; dismissible: boolean; node: ReactNode };

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
  const billingHref = `/${workspace.slugOrId}/settings/billing`;

  const dismiss = (bannerId: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(dismissKey(workspace.id, bannerId), "1");
    }
    forceRerender();
  };

  let banners: DisplayBanner[];
  if (usage.throttle && !onBillingPage && !(usage.throttle >= 100 && serverBanners.length > 0)) {
    banners = [
      {
        id: "client-throttle",
        dismissible: false,
        node: (
          <ClientBannerCard
            theme="error"
            title="Workspace throttled"
            badge={`${usage.throttle}% THROTTLED`}
            body={
              <>
                Part of your events are not being delivered — your workspace is throttled at <b>{usage.throttle}%</b>{" "}
                due to exceeding the free plan quota.
              </>
            }
            actionLabel="See details"
            actionHref={billingHref}
          />
        ),
      },
    ];
  } else if (serverBanners.length > 0) {
    banners = serverBanners.map(banner => ({
      id: banner.id,
      dismissible: banner.dismissible,
      node: (
        // Dismissible server cards contain a `data-banner-dismiss` ✕ rendered
        // by billing as part of the card layout; it carries no behavior of its
        // own — this delegated click handler supplies it.
        <div
          onClick={e => {
            if ((e.target as Element).closest?.("[data-banner-dismiss]")) {
              dismiss(banner.id);
            }
          }}
          dangerouslySetInnerHTML={{ __html: sanitize(banner.html) }}
        />
      ),
    }));
  } else if (usageIsAboutToExceed(billing, usage) && !onBillingPage) {
    const projectionId = `client-projection:${usage.usage?.periodEnd?.toISOString() ?? "period"}`;
    banners = [
      {
        id: projectionId,
        dismissible: true,
        node: (
          <ClientBannerCard
            theme="warning"
            title="Projected to exceed your quota"
            badge="PROJECTION"
            body="At the current pace you'll exceed your monthly events quota before the period ends. Upgrade your plan to avoid service disruption."
            actionLabel="Upgrade"
            actionHref={billingHref}
            onDismiss={() => dismiss(projectionId)}
          />
        ),
      },
    ];
  } else {
    banners = [];
  }

  const isDismissed = (banner: DisplayBanner) =>
    banner.dismissible &&
    typeof window !== "undefined" &&
    !!window.localStorage.getItem(dismissKey(workspace.id, banner.id));
  const visibleBanners = banners.filter(banner => !isDismissed(banner));
  if (visibleBanners.length === 0) {
    return null;
  }

  return (
    <>
      {visibleBanners.map(banner => (
        <div key={banner.id} className="mt-4">
          {banner.node}
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
