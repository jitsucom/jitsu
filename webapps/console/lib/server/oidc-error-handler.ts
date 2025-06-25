import { NextApiResponse } from "next";
import { getServerLog } from "./log";

const log = getServerLog("oidc-error-handler");

export interface OidcErrorRedirectOptions {
  error: string;
  message?: string;
  returnUrl?: string;
}

/**
 * Centralized error redirect handler for OIDC flows
 * @param res NextApiResponse object
 * @param options Error details and optional return URL
 */
export function redirectWithOidcError(res: NextApiResponse, options: OidcErrorRedirectOptions): void {
  const { error, message, returnUrl } = options;

  // Build query parameters
  const params = new URLSearchParams({
    error,
    ...(message && { message: message }),
    ...(returnUrl && { callbackUrl: returnUrl }),
  });

  const redirectUrl = `/signin?${params.toString()}`;

  log.atWarn().log("Redirecting with OIDC error", {
    error,
    message,
    hasReturnUrl: !!returnUrl,
    redirectUrl,
  });

  res.redirect(redirectUrl);
}

/**
 * Common OIDC error types
 */
export const OidcErrors = {
  AUTH_ERROR: "oidc_auth_error",
  MISSING_PARAMS: "missing_params",
  INVALID_STATE: "invalid_state",
  STATE_EXPIRED: "state_expired",
  PROVIDER_NOT_FOUND: "provider_not_found",
  TOKEN_EXCHANGE_FAILED: "token_exchange_failed",
  INVALID_ID_TOKEN: "invalid_id_token",
  INVALID_ISSUER: "invalid_issuer",
  INVALID_AUDIENCE: "invalid_audience",
  INVALID_NONCE: "invalid_nonce",
  TOKEN_EXPIRED: "token_expired",
  USERINFO_FETCH_FAILED: "userinfo_fetch_failed",
  NO_USER_INFO: "no_user_info",
  NO_EMAIL: "no_email",
  NO_WORKSPACE_ACCESS: "no_workspace_access",
  INTERNAL_ERROR: "internal_error",
} as const;

export type OidcErrorType = (typeof OidcErrors)[keyof typeof OidcErrors];
