import { useCallback } from "react";
import { getLog, rpc } from "juava";
import { useAppConfig } from "./context";
import { getFirebaseIdToken } from "./firebase-client";

const log = getLog("eeApi");

export type EeApiOptions = {
  method?: string;
  query?: Record<string, any>;
  body?: any;
};

/**
 * Thrown when a browser-side call to ee-api can't be authenticated because the
 * user has no Firebase session. Distinct from a network/HTTP error so callers
 * can render an actionable message (sign in / contact admin) instead of a
 * generic 500.
 */
export class EeApiNotAuthenticatedError extends Error {
  constructor() {
    super(
      "Not authenticated against ee-api: no Firebase ID token. " +
        "Browser→ee-api calls (billing pages, S3 init, etc.) require a Firebase session."
    );
    this.name = "EeApiNotAuthenticatedError";
  }
}

export type EeApi = {
  /** True when an ee-api host is configured (i.e. this is an EE deployment). */
  available: boolean;
  /**
   * Call an ee-api endpoint directly from the browser. The request carries the
   * signed-in user's Firebase ID token in the `x-fb-auth` header; ee-api
   * verifies it and decides admin status and workspace access on its own —
   * there is no console-side proxy or minted token. `path` is relative to
   * ee-api's `/api/`, e.g. `eeRpc("billing/settings", { query: { workspaceId } })`.
   *
   * Throws `EeApiNotAuthenticatedError` if no Firebase ID token is available —
   * see the module-level note about the Cloud-only scope.
   */
  eeRpc: <T = any>(path: string, opts?: EeApiOptions) => Promise<T>;
};

/**
 * Browser client for ee-api.
 *
 * **Scope: Jitsu Cloud only.** ee-api hosts enterprise/billing features that
 * only run in our hosted product, and Cloud authenticates users exclusively
 * through Firebase (Google sign-in / Firebase email-password). The browser
 * sends its Firebase ID token in `x-fb-auth`; ee-api verifies it server-side.
 *
 * Self-hosted deployments that use NextAuth/OIDC/credentials login are kept
 * out of this path at the source: `pages/api/app-config.ts` returns
 * `ee.available = false` whenever Firebase isn't enabled, even if
 * `EE_CONNECTION` is set. Callers that check `appConfig.ee.available` (S3
 * init, billing UI, EE-flavored UI hints) therefore skip cleanly in those
 * deployments. Reaching `eeRpc()` without a Firebase session on a Cloud
 * deployment is a programming error (e.g. forgot to render a Firebase login
 * gate) and throws `EeApiNotAuthenticatedError` so the failure surfaces in
 * logs instead of as a generic 500 from a stripped-token request.
 *
 * If a future use case needs ee-api access from a non-Firebase deployment,
 * the right move is a server-side proxy on console that authenticates with
 * `EE_API_SERVICE_TOKEN` — never client-side direct calls.
 */
export function useEeApi(): EeApi {
  const appConfig = useAppConfig();
  const host = appConfig.ee?.host;
  const eeRpc = useCallback(
    async <T = any>(path: string, opts?: EeApiOptions): Promise<T> => {
      if (!host) {
        // Self-hosted / non-EE deployment. Callers should check `available`
        // first; reaching here means they didn't.
        throw new Error(`ee-api is not configured (EE_CONNECTION unset). Path: ${path}`);
      }
      const idToken = await getFirebaseIdToken();
      if (!idToken) {
        log
          .atWarn()
          .log(
            `eeRpc(${path}) called without a Firebase session — this only works on Jitsu Cloud ` +
              `where Firebase login is mandatory. See lib/eeApi.ts.`
          );
        throw new EeApiNotAuthenticatedError();
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
