import { NextApiRequest, NextApiResponse } from "next";
import { serialize } from "cookie";
import { withErrorHandler } from "../../../lib/route-helpers";
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
  // The auth cookie is always Secure in production. Deriving this from the
  // request (e.g. X-Forwarded-Proto) would let a client downgrade the cookie
  // to non-Secure by spoofing that header.
  const secure = process.env.NODE_ENV === "production";

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

  // The admin UI signs in exclusively with Google. Requiring the google.com
  // provider and a verified email stops a token from another enabled Firebase
  // provider (or an unverified email/password account) from being exchanged
  // for an admin session when the allow-list uses domain wildcards (`*@jitsu.com`).
  if (decoded.firebase?.sign_in_provider !== "google.com" || decoded.email_verified !== true) {
    log
      .atWarn()
      .log(
        `Rejected sign-in for ${decoded.email}: provider=${decoded.firebase?.sign_in_provider}, ` +
          `email_verified=${decoded.email_verified}`
      );
    res.status(403).json({ ok: false, error: "Sign in with a verified Google account." });
    return;
  }

  // Only mint a long-lived (5-day) session cookie from a recent sign-in, so a
  // replayed or stolen ID token (valid for up to an hour) can't be upgraded
  // into a much longer-lived session.
  const authAgeSeconds = Date.now() / 1000 - decoded.auth_time;
  if (authAgeSeconds > 5 * 60) {
    log.atWarn().log(`Rejected stale sign-in for ${decoded.email}: authenticated ${Math.round(authAgeSeconds)}s ago`);
    res.status(401).json({ ok: false, error: "Sign-in is no longer fresh, please sign in again." });
    return;
  }

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
