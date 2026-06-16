import { createRoute } from "../../../lib/api";
import {
  clearLegacyHostAuthCookie,
  firebaseAuthCookieName,
  getAuthCookieDomain,
  signOut,
} from "../../../lib/server/firebase-server";
import { serialize } from "cookie";
import { getAppEndpoint } from "../../../lib/domains";
import { getServerLog } from "../../../lib/server/log";
import { authAuditLog } from "../../../lib/server/audit-log";

const log = getServerLog("firebase");

export default createRoute()
  .GET({ auth: true })
  .handler(async ({ req, body, res, user }) => {
    await signOut(user.externalId);
    try {
      await authAuditLog({ internalId: user.internalId, email: user.email, name: user.name }, "logout", "firebase");
    } catch (err) {
      log
        .atError()
        .withCause(err as Error)
        .log("Failed to record firebase logout audit event");
    }
    const secure = getAppEndpoint(req).protocol === "https";
    // Name, path and domain must all match create-session, or the real cookie
    // won't be cleared.
    const domain = getAuthCookieDomain(req);
    const clearCookies = [
      serialize(firebaseAuthCookieName, "", {
        maxAge: 0,
        httpOnly: true,
        secure,
        path: "/",
        ...(domain ? { domain } : {}),
      }),
    ];
    // When AUTH_COOKIE_DOMAIN is set, also clear any legacy host-scoped
    // (Domain=<request host>) copy from pre-AUTH_COOKIE_DOMAIN builds, which the
    // parent-domain clear above misses. No-op when AUTH_COOKIE_DOMAIN is unset.
    const legacyClear = clearLegacyHostAuthCookie(req, { secure });
    if (legacyClear) {
      clearCookies.push(legacyClear);
    }
    res.setHeader("Set-Cookie", clearCookies);
  })
  .toNextApiHandler();
