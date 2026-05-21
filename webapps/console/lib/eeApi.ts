import { useCallback } from "react";
import { rpc } from "juava";
import { useAppConfig } from "./context";
import { getFirebaseIdToken } from "./firebase-client";

export type EeApiOptions = {
  method?: string;
  query?: Record<string, any>;
  body?: any;
};

export type EeApi = {
  /** True when an ee-api host is configured (i.e. this is an EE deployment). */
  available: boolean;
  /**
   * Call an ee-api endpoint directly from the browser. The request carries the
   * signed-in user's Firebase ID token in the `x-fb-auth` header; ee-api
   * verifies it and decides admin status and workspace access on its own —
   * there is no console-side proxy or minted token. `path` is relative to
   * ee-api's `/api/`, e.g. `eeRpc("billing/settings", { query: { workspaceId } })`.
   */
  eeRpc: <T = any>(path: string, opts?: EeApiOptions) => Promise<T>;
};

export function useEeApi(): EeApi {
  const appConfig = useAppConfig();
  const host = appConfig.ee?.host;
  const eeRpc = useCallback(
    async <T = any>(path: string, opts?: EeApiOptions): Promise<T> => {
      if (!host) {
        throw new Error("EE API is not available");
      }
      const idToken = await getFirebaseIdToken();
      if (!idToken) {
        throw new Error("Not authenticated");
      }
      return rpc(`${host}api/${path.replace(/^\/+/, "")}`, {
        method: opts?.method,
        query: opts?.query,
        body: opts?.body,
        headers: { "x-fb-auth": idToken },
      });
    },
    [host]
  );
  return { available: !!host, eeRpc };
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
