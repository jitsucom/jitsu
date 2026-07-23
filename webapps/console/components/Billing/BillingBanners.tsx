import React, { useReducer, useState } from "react";
import { Modal } from "antd";
import DOMPurify from "dompurify";
import { AlertTriangle, X } from "lucide-react";
import { useRouter } from "next/router";
import { useBilling } from "./BillingProvider";
import { useWorkspace } from "../../lib/context";
import { useApi } from "../../lib/useApi";
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
 * The full banner list — including the active-throttle and projection banners
 * that used to be computed client-side — comes from the server
 * (composeWorkspaceBanners in the billing repo, JITSU-123 item d); this
 * component only renders and dismisses.
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

/**
 * A safe navigation target: workspace-relative console path — starts with a
 * single "/", and no dot segments (decoded), so it cannot escape the
 * `/${workspace}` prefix WJitsuButton prepends or go off-origin.
 */
const isSafeLocation = (location: string): boolean => {
  if (!location.startsWith("/") || location.startsWith("//")) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(location);
  } catch {
    return false;
  }
  return !decoded.split("/").some(segment => segment === ".." || segment === ".");
};

// Any <a href> surviving sanitization must satisfy the same rules as
// action.location — inline links must not become an off-origin escape hatch.
let dompurifyHookInstalled = false;
const installHook = () => {
  if (!dompurifyHookInstalled && typeof window !== "undefined") {
    DOMPurify.addHook("afterSanitizeAttributes", node => {
      if (node.tagName === "A" && !isSafeLocation(node.getAttribute("href") || "")) {
        node.removeAttribute("href");
      }
    });
    dompurifyHookInstalled = true;
  }
};

// Banner body/icon fragments are copy + widgets (progress bar, icon glyph):
// structural markup and inline styles, no script vectors.
const sanitize = (html: string) => {
  installHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["div", "span", "p", "a", "b", "i", "em", "strong", "u", "s", "code", "br"],
    ALLOWED_ATTR: ["href", "style"],
  });
};

// Subtitles are one-line captions: inline formatting only — no styles, no
// structure, no links.
const sanitizeInline = (html: string) => {
  installHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "u", "s", "code", "br"],
    ALLOWED_ATTR: [],
  });
};

const Html: React.FC<{ html: string; className?: string; inline?: boolean }> = ({ html, className, inline }) => (
  <span className={className} dangerouslySetInnerHTML={{ __html: inline ? sanitizeInline(html) : sanitize(html) }} />
);

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

/**
 * The banner card template (design: JITSU-88 mock) filled from a BillingBanner
 * payload. `compact` omits the extra widget zone, the action column and the ✕ —
 * used when the banner is nested in a context that already provides them (the
 * billing page's Event usage section).
 */
export const BannerCard: React.FC<{ banner: BillingBanner; onClose?: () => void; compact?: boolean }> = ({
  banner,
  onClose,
  compact,
}) => {
  const t = themes[banner.severity];
  // Only workspace-relative console paths — a server bug/compromise must not
  // be able to send users off-origin (WJitsuButton prefixes the workspace).
  const action = banner.action && isSafeLocation(banner.action.location) ? banner.action : undefined;
  // Fall back to the default severity icon when the override sanitizes to
  // nothing (e.g. markup outside the allowlist) — never render a blank tile.
  const iconHtml = banner.icon ? sanitize(banner.icon) : "";
  return (
    <div className={`flex items-start gap-4 rounded-xl border border-l-4 py-5 px-6 ${t.card}`}>
      <div className={`flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center ${t.iconBox}`}>
        {iconHtml.trim() ? (
          <span dangerouslySetInnerHTML={{ __html: iconHtml }} />
        ) : (
          <span className="text-xl font-extrabold">!</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap -mt-0.5">
          <span className="text-lg font-bold text-neutral-900 leading-6">{banner.title}</span>
          <span className={`text-xs font-bold tracking-wide rounded-full border px-2.5 py-0.5 ${t.badge}`}>
            {banner.badge}
          </span>
        </div>
        <Html className="block mt-1.5 text-sm text-neutral-600 leading-relaxed" html={banner.body} />
        {!compact && banner.extra && <Html className="block" html={banner.extra} />}
      </div>
      {!compact && action && (
        <div className="flex-shrink-0 ml-2 flex flex-col items-end gap-2.5">
          <WJitsuButton href={action.location} type="primary" size="large">
            {action.text}
          </WJitsuButton>
          {action.subtitle && <Html inline className="text-[12.5px] text-gray-500" html={action.subtitle} />}
        </div>
      )}
      {!compact && banner.closeable && onClose && (
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

/**
 * Blocking-modal presentation of a banner payload (kind: "modal") — replaces
 * the old hardcoded BillingBlockingDialog. The mask is not closable; Jitsu
 * admins (user-properties `admin` flag) can dismiss regardless of `closeable`.
 * Dismissal is session-only — the modal returns on the next mount.
 */
const modalAccents: Record<BillingBanner["severity"], string> = {
  info: "bg-blue-600",
  warning: "bg-amber-600",
  error: "bg-red-600",
};

const BannerModal: React.FC<{ banner: BillingBanner; adminCanClose: boolean }> = ({ banner, adminCanClose }) => {
  const [open, setOpen] = useState(true);
  const t = themes[banner.severity];
  // A blocking modal must always offer a way forward: fall back to the billing
  // page when the payload has no (safe) action.
  const action =
    banner.action && isSafeLocation(banner.action.location)
      ? banner.action
      : { text: "Go to billing", location: "/settings/billing", subtitle: undefined };
  const canClose = adminCanClose || banner.closeable;
  const iconHtml = banner.icon ? sanitize(banner.icon) : "";
  return (
    <Modal
      width={600}
      open={open}
      closable={canClose}
      keyboard={canClose}
      onCancel={() => setOpen(false)}
      maskClosable={false}
      footer={null}
    >
      {/* Top accent bar — the modal's counterpart of the card's accent edge;
          negative margins span it across the modal's built-in padding. */}
      <div className={`h-1 -mx-6 -mt-5 mb-5 rounded-t-lg ${modalAccents[banner.severity]}`} />
      <div className="flex items-center gap-3.5">
        <div className={`flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center ${t.iconBox}`}>
          {iconHtml.trim() ? (
            <span dangerouslySetInnerHTML={{ __html: iconHtml }} />
          ) : (
            <AlertTriangle className="w-6 h-6" />
          )}
        </div>
        <div className="flex-1 flex items-center gap-2.5 flex-wrap">
          <span className="text-lg font-bold text-neutral-900 leading-6">{banner.title}</span>
          <span className={`text-xs font-bold tracking-wide rounded-full border px-2.5 py-0.5 ${t.badge}`}>
            {banner.badge}
          </span>
        </div>
      </div>
      <div className="pl-[58px]">
        <Html className="block mt-2 text-sm text-neutral-600 leading-relaxed" html={banner.body} />
        {banner.extra && <Html className="block" html={banner.extra} />}
        <div className="mt-5">
          <WJitsuButton href={action.location} className="w-full" size="large" type="primary">
            {action.text}
          </WJitsuButton>
          {action.subtitle && (
            <div className="text-center mt-2.5">
              <Html inline className="text-[12.5px] text-gray-500" html={action.subtitle} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

/**
 * Pages a blocking modal must never cover: everything the user needs to fix
 * billing (matches the pages the old dialog excluded via
 * doNotBlockIfUsageExceeded).
 */
const MODAL_EXEMPT_PAGES = ["/settings", "/settings/domains", "/settings/billing", "/settings/billing/details"];

const BillingBannersInner: React.FC<{ modalsOnly?: boolean }> = ({ modalsOnly }) => {
  const billing = useBilling();
  const workspace = useWorkspace();
  const router = useRouter();
  const { data: userProps } = useApi(`/api/user/properties`);
  const [, forceRerender] = useReducer(x => x + 1, 0);

  const serverAll = (billing.enabled && billing.settings?.banners) || [];
  const serverModals = serverAll.filter(banner => banner.kind === "modal");
  const serverBanners = serverAll.filter(banner => banner.kind !== "modal");
  // The billing page nests non-modal banners under its Events Usage section
  // (BillingManager) — the top strip honors the payloads' onBillingPage flags.
  const onBillingPage = router.pathname.endsWith("/settings/billing");

  let banners: BillingBanner[] = serverBanners;

  // Server-controlled visibility on the billing settings page: banners and
  // actions carry an `onBillingPage` flag (missing = show). Warnings hide
  // there entirely; the blocked banner shows but drops its action (which
  // would navigate to the very page the user is on).
  if (onBillingPage) {
    banners = banners
      .filter(banner => banner.onBillingPage !== false)
      .map(banner => (banner.action?.onBillingPage === false ? { ...banner, action: undefined } : banner));
  }

  const isDismissed = (banner: BillingBanner) =>
    banner.closeable && !!safeStorageGet(dismissKey(workspace.id, banner.id));
  // modalsOnly: fullscreen pages mount a second instance that renders only the
  // blocking modals — cards have no place in fullscreen chrome.
  const visibleBanners = modalsOnly ? [] : banners.filter(banner => !isDismissed(banner));

  // Blocking modals render independently of the card-priority chain, but never
  // on the pages the user needs to fix billing.
  const onModalExemptPage = MODAL_EXEMPT_PAGES.some(page => router.pathname.endsWith(page));
  const visibleModals = onModalExemptPage ? [] : serverModals;

  if (visibleBanners.length === 0 && visibleModals.length === 0) {
    return null;
  }

  return (
    <>
      {visibleModals.map(banner => (
        <BannerModal key={banner.id} banner={banner} adminCanClose={!!userProps?.admin} />
      ))}
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

export const BillingBanners: React.FC<{ modalsOnly?: boolean }> = ({ modalsOnly }) => {
  const billing = useBilling();
  // Banners exist only for enabled, loaded billing.
  if (!billing.enabled || billing.loading) {
    return null;
  }
  return <BillingBannersInner modalsOnly={modalsOnly} />;
};
