import { NextApiRequest, NextApiResponse } from "next";
import { serialize } from "cookie";
import { getOrigin, withErrorHandler } from "../../../lib/route-helpers";
import {
  createSessionCookie,
  firebaseAuthCookieName,
  isFirebaseEnabled,
  verifyIdToken,
} from "../../../lib/firebase-auth";
import { isAdminEmail } from "../../../lib/admins";
import { getServerLog } from "../../../lib/log";

const log = getServerLog("admin-session");

const csrfCookieName = "fb-csrfToken";

/**
 * Admin session endpoint.
 *
 *  - POST   — verify a Firebase ID token, check it against the
 *             `JITSU_EE_ADMINS` allow-list and mint an httpOnly session cookie.
 *  - DELETE — clear the session cookie (logout).
 */
const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const secure = getOrigin(req).startsWith("https");

  if (req.method === "DELETE") {
    res.setHeader(
      "Set-Cookie",
      serialize(firebaseAuthCookieName, "", { httpOnly: true, secure, path: "/", sameSite: "lax", maxAge: 0 })
    );
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!isFirebaseEnabled()) {
    res.status(500).json({ ok: false, error: "Firebase auth is not configured" });
    return;
  }

  const { idToken, csrfToken } = req.body || {};
  if (!idToken || !csrfToken) {
    res.status(400).json({ ok: false, error: "idToken and csrfToken are required" });
    return;
  }
  if (csrfToken !== req.cookies[csrfCookieName]) {
    res.status(401).json({ ok: false, error: "CSRF token mismatch" });
    return;
  }

  const decoded = await verifyIdToken(idToken);
  const email = decoded.email;
  if (!email || !isAdminEmail(email)) {
    log.atWarn().log(`Rejected non-admin sign-in: ${email || "<no email>"}`);
    res.status(403).json({ ok: false, error: `Account ${email || ""} is not authorized to access this app.` });
    return;
  }

  const { cookie, expiresIn } = await createSessionCookie(idToken);
  res.setHeader(
    "Set-Cookie",
    serialize(firebaseAuthCookieName, cookie, {
      httpOnly: true,
      secure,
      path: "/",
      sameSite: "lax",
      maxAge: Math.floor(expiresIn / 1000),
    })
  );
  log.atInfo().log(`Admin signed in: ${email}`);
  res.status(200).json({ ok: true });
};

export default withErrorHandler(handler);
