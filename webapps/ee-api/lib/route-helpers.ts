import { getErrorMessage } from "juava";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getServerLog } from "./log";
import { getFirebaseToken, verifyFirebaseToken } from "./firebase-auth";
import type admin from "firebase-admin";
import { isAdminEmail } from "./admins";
import { isOriginAllowed, parseAllowedOrigins } from "./app-urls";

const log = getServerLog("api-error");
const authLog = getServerLog("admin-auth");

export function withErrorHandler(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent && result) {
        res.status(200).json(result);
      } else if (!res.headersSent) {
        res.status(200).end();
      }
    } catch (err) {
      log.atError().withCause(err).log(`Error handling API request: ${req.method} ${req.url}`, err);
      if (!res.headersSent) {
        // Honor a declared `httpStatus` on typed errors (e.g. `AccessDeniedError`,
        // `WorkspaceNotFoundError`) so they surface as 403/404 instead of 500.
        const status = typeof (err as any)?.httpStatus === "number" ? (err as any).httpStatus : 500;
        res.status(status).json({ error: getErrorMessage(err) });
      } else {
        log.atWarn().log(`Response already sent, not sending error message`);
      }
    }
  };
}

/**
 * CORS for ee-api endpoints the console browser app calls directly. The request
 * carries a Firebase ID token in `x-fb-auth` (not cookies). Returns `true` if
 * the request was a preflight that has now been answered — the caller should
 * stop.
 *
 * Allowed origins come from `JITSU_APPLICATION_URL` (comma-separated list,
 * `*.host` wildcards supported). Credentials aren't sent (auth is via header,
 * not cookies), but reflecting any Origin would still let attacker-controlled
 * pages READ responses for someone holding a Firebase ID token — so the check
 * is real.
 */
export function applyCors(req: NextApiRequest, res: NextApiResponse): boolean {
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  const allowed = parseAllowedOrigins(process.env.JITSU_APPLICATION_URL);
  if (isOriginAllowed(origin, allowed)) {
    res.setHeader("Access-Control-Allow-Origin", origin as string);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-fb-auth, baggage, sentry-trace");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

/**
 * Wrap a browser-facing ee-api handler: applies CORS (and answers preflight
 * requests) on top of `withErrorHandler`.
 */
export function withBrowserApi(handler: NextApiHandler): NextApiHandler {
  return withErrorHandler(async (req, res) => {
    if (applyCors(req, res)) {
      return;
    }
    return handler(req, res);
  });
}

/** An authenticated admin, resolved from a verified Firebase token. */
export type AdminClaim = { uid: string; email: string };

/** API handler that runs only after the request is authenticated as an admin. */
export type AdminApiHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
  admin: AdminClaim
) => unknown | Promise<unknown>;

/**
 * Wrap an API handler so it runs only for an authenticated admin.
 *
 * The caller's Firebase credential is read the same way `lib/auth.ts` reads it
 * — `x-fb-auth` header (browser ID token) or `fb-auth2` session cookie. There
 * is no path through `Authorization: Bearer` here; that header is reserved
 * for system tokens (which the admin UI doesn't issue).
 *
 * The request is admitted only for a verified Google sign-in whose email is on
 * the `JITSU_EE_ADMINS` allow-list. The Google-only gate (vs `auth()`, which
 * accepts any verified Firebase email) is the extra hardening for the admin
 * UI: an internal admin email on an `@jitsu.com` address must come from our
 * Google Workspace, not an email/password account someone registered with the
 * same address. Same bar enforced when the session cookie is minted (see
 * `pages/api/admin/session.ts`).
 *
 *   export default withFirebaseAdminAuth(async (req, res, admin) => {
 *     return { hello: admin.email };
 *   });
 */
export function withFirebaseAdminAuth(handler: AdminApiHandler): NextApiHandler {
  return withErrorHandler(async (req, res) => {
    const token = getFirebaseToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: "Not authenticated" });
      return;
    }
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await verifyFirebaseToken(token);
    } catch (e) {
      authLog
        .atWarn()
        .withCause(e)
        .log(`Failed to verify Firebase token: ${getErrorMessage(e)}`);
      res.status(401).json({ ok: false, error: "Invalid or expired authentication" });
      return;
    }
    const isGoogle = decoded.firebase?.sign_in_provider === "google.com";
    if (!isGoogle || decoded.email_verified !== true || !isAdminEmail(decoded.email)) {
      authLog.atWarn().log(`Rejected non-admin request: ${decoded.email || "<no email>"}`);
      res.status(403).json({ ok: false, error: "Not authorized" });
      return;
    }
    return handler(req, res, { uid: decoded.uid, email: decoded.email as string });
  });
}

export function getOrigin(req: NextApiRequest) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const forwardedPort = req.headers["x-forwarded-port"];
  const protocol = forwardedProto || (process.env.NODE_ENV === "production" ? "https" : "http");
  const host = forwardedHost || req.headers["host"];
  const port = forwardedPort && !host?.includes(":") ? `:${forwardedPort}` : "";
  return `${protocol}://${host}${port}`;
}
