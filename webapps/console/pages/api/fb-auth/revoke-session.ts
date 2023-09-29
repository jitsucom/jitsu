import { createRoute } from "../../../lib/api";
import { firebaseAuthCookieName, signOut } from "../../../lib/server/firebase-server";
import { serialize } from "cookie";
import { getAppEndpoint } from "../../../lib/domains";
import { getServerLog } from "../../../lib/server/log";

export const log = getServerLog("firebase");

export default createRoute()
  .GET({ auth: true })
  .handler(async ({ req, body, res, user }) => {
    await signOut(user.externalId);
    const secure = getAppEndpoint(req).protocol === "https";
    res.setHeader(
      "Set-Cookie",
      serialize(firebaseAuthCookieName, "", {
        maxAge: 0,
        httpOnly: true,
        secure,
      })
    );
  })
  .toNextApiHandler();
