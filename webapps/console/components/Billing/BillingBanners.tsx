import React, { useReducer } from "react";
import { Alert } from "antd";
import { useBilling } from "./BillingProvider";
import { useWorkspace } from "../../lib/context";
import { WJitsuButton } from "../JitsuButton/JitsuButton";

/**
 * In-app banners provided by the billing API (JITSU-88). The console owns no
 * copy or policy — the billing/settings response describes each banner in full
 * (severity, dismissibility, HTML body, optional action button) and this
 * component renders them verbatim. The HTML comes from our own billing server,
 * so it is trusted.
 *
 * Dismissals are client-side, keyed by workspace + the banner's server-provided
 * stable `id` — the server changes the id (e.g. new severity level or billing
 * period) to re-show a previously dismissed banner.
 */

const dismissKey = (workspaceId: string, bannerId: string) => `billing-banner-dismissed:${workspaceId}:${bannerId}`;

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
            message={<span dangerouslySetInnerHTML={{ __html: banner.html }} />}
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
