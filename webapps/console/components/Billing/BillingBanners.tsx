import React, { useReducer } from "react";
import { Alert } from "antd";
import DOMPurify from "dompurify";
import { useBilling } from "./BillingProvider";
import { useWorkspace } from "../../lib/context";
import { WJitsuButton } from "../JitsuButton/JitsuButton";

/**
 * In-app banners provided by the billing API (JITSU-88). The console owns no
 * copy or policy — the billing/settings response describes each banner in full
 * (severity, dismissibility, HTML body, optional action button) and this
 * component renders them verbatim. The HTML comes from our own billing server,
 * but is still sanitized to a small inline-formatting allowlist before
 * rendering — a compromised or misbehaving billing response must not be able to
 * run script in the console origin.
 *
 * Dismissals are client-side, keyed by workspace + the banner's server-provided
 * stable `id` — the server changes the id (e.g. new severity level or billing
 * period) to re-show a previously dismissed banner.
 */

const dismissKey = (workspaceId: string, bannerId: string) => `billing-banner-dismissed:${workspaceId}:${bannerId}`;

// Banner bodies are one-line messages: inline formatting and links only.
const sanitize = (html: string) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "u", "s", "code", "a", "br", "span"],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });

export const BillingBanners: React.FC = () => {
  const billing = useBilling();
  const workspace = useWorkspace();
  const [, forceRerender] = useReducer(x => x + 1, 0);

  const banners = billing.enabled && !billing.loading ? billing.settings.banners ?? [] : [];
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
