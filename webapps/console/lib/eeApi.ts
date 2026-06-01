import { useCallback } from "react";
import { rpc } from "juava";
import { useAppConfig } from "./context";

export type EeApiOptions = {
  method?: string;
  query?: Record<string, any>;
  body?: any;
};

/**
 * Kept for backward compatibility — the proxy handles authentication
 * server-side via the console session, so this is no longer thrown from
 * the request path. It remains exported in case any caller still does
 * `instanceof EeApiNotAuthenticatedError`.
 */
export class EeApiNotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated against ee-api.");
    this.name = "EeApiNotAuthenticatedError";
  }
}

export type EeApi = {
  /** True when an ee-api host is configured (i.e. this is an EE deployment). */
  available: boolean;
  /**
   * Call an ee-api endpoint via the console's own server-side proxy at
   * `/api/ee/<path>`. The console authenticates the user from the session
   * cookie and forwards the Firebase credential to billing-server; the
   * browser does NOT carry the billing-server URL or a billing token.
   * `path` is relative to ee-api's `/api/`, e.g. `eeRpc("billing/settings", { query: { workspaceId } })`.
   */
  eeRpc: <T = any>(path: string, opts?: EeApiOptions) => Promise<T>;
};

/**
 * Browser client for ee-api, routed through the console's server-side proxy
 * (`pages/api/ee/[...path].ts`). The browser issues a same-origin request to
 * `/api/ee/<path>`; the console authenticates the user from its session,
 * forwards the request to billing-server, and returns the JSON response.
 *
 * **Scope: Jitsu Cloud only.** Billing-server's user routes verify identity
 * from the forwarded Firebase token. Deployments without Firebase login set
 * `appConfig.ee.available = false`, so callers (S3 init, billing UI, EE-flavored
 * UI hints) skip cleanly. The proxy itself also refuses non-Firebase callers
 * with 401.
 */
export function useEeApi(): EeApi {
  const appConfig = useAppConfig();
  const available = !!appConfig.ee?.available;
  const eeRpc = useCallback(
    async <T = any>(path: string, opts?: EeApiOptions): Promise<T> => {
      if (!available) {
        // Self-hosted / non-EE deployment. Callers should check `available`
        // first; reaching here means they didn't.
        throw new Error(`ee-api is not configured (EE_CONNECTION unset). Path: ${path}`);
      }
      const cleanPath = path.replace(/^\/+/, "");
      return rpc(`/api/ee/${cleanPath}`, {
        method: opts?.method,
        query: opts?.query,
        body: opts?.body,
      });
    },
    [available]
  );
  return { available, eeRpc };
}

/**
 * Returns a function that calls a redirect-style ee-api endpoint (Stripe
 * billing portal / checkout), which responds with `{ url }`, then navigates
 * the browser to that URL.
 */
export function useEeRedirect(): (path: string, query?: Record<string, any>) => Promise<void> {
  const { eeRpc } = useEeApi();
  return useCallback(
    async (path: string, query?: Record<string, any>) => {
      const { url } = await eeRpc<{ url: string }>(path, { query });
      window.location.href = url;
    },
    [eeRpc]
  );
}
