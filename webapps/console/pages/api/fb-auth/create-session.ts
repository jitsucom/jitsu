import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { createSessionCookie, firebaseAuthCookieName } from "../../../lib/server/firebase-server";
import { ApiError } from "../../../lib/shared/errors";
import { CookieSerializeOptions, serialize } from "cookie";
import { getAppEndpoint } from "../../../lib/domains";
import { getRequestHost } from "../../../lib/server/origin";
import { getServerLog } from "../../../lib/server/log";
import { getLog } from "juava";

const log = getServerLog("firebase");

export const api: Api = {
  url: inferUrl(__filename),
  POST: {
    auth: false,
    types: {
      body: z.object({
        csrfToken: z.string(),
        idToken: z.string(),
      }),
    },
    handle: async ({ req, body, res }) => {
      const { csrfToken, idToken } = body;
      const secure = getAppEndpoint(req).protocol === "https";
      const csrfCookie = req.cookies["fb-csrfToken"];
      if (csrfToken !== csrfCookie) {
        log
          .atError()
          .log(`CSRF cookie (${csrfCookie}) doesn't match provided token ${csrfToken}`, JSON.stringify(req.cookies));
        throw new ApiError("CSRF error", {}, { status: 401 });
      }
      const { cookie, expiresIn } = await createSessionCookie(idToken);
      //we need to split() since the domain might contain a port, not good for cookies
      const domain = getRequestHost(req).split(":")[0];
      getLog().atDebug().log(`Setting firebase auth cookie for '${domain}': ${cookie}`);
      const options: CookieSerializeOptions = {
        maxAge: expiresIn,
        httpOnly: true,
        secure,
        path: "/",
        sameSite: "lax",
        domain,
      };
      res.setHeader("Set-Cookie", serialize(firebaseAuthCookieName, cookie, options));

      return { ok: true };
    },
  },
};

export default nextJsApiHandler(api);
