import { createRoute } from "../../../lib/api";
import { getLog } from "juava";
import { firebaseAuthCookieName, signOut } from "../../../lib/server/firebase-server";
import { serialize } from "cookie";
import { getAppEndpoint } from "../../../lib/domains";

export const log = getLog("firebase");

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
