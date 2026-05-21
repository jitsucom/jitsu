import { getErrorMessage } from "juava";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getServerLog } from "./log";
import { getFirebaseToken, verifyFirebaseSessionCookie, verifyIdToken } from "./firebase-auth";
import { isAdminEmail } from "./admins";

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
        res.status(500).json({ error: getErrorMessage(err) });
      } else {
        log.atWarn().log(`Response already sent, not sending error message`);
      }
    }
  };
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
 * The caller's Firebase credential is read from the `fb-auth2` session cookie
 * or an `Authorization: Bearer <idToken>` header. The request is admitted only
 * for a verified Google sign-in whose email is on the `JITSU_EE_ADMINS`
 * allow-list — the same bar enforced when the session cookie is minted (see
 * `pages/api/admin/session.ts`). Error handling is included.
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
    let decoded: Awaited<ReturnType<typeof verifyIdToken>>;
    try {
      decoded = token.idToken
        ? await verifyIdToken(token.idToken)
        : await verifyFirebaseSessionCookie(token.cookieToken as string);
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
