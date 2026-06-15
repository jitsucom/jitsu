import { createRoute } from "../../../lib/api";
import { firebaseAuthCookieName, getAuthCookieDomain, signOut } from "../../../lib/server/firebase-server";
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
    const domain = getAuthCookieDomain();
    res.setHeader(
      "Set-Cookie",
      serialize(firebaseAuthCookieName, "", {
        maxAge: 0,
        httpOnly: true,
        secure,
        path: "/",
        ...(domain ? { domain } : {}),
      })
    );
  })
  .toNextApiHandler();
