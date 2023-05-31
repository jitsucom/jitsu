import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { getLog } from "juava";
import { z } from "zod";
import { createSessionCookie, firebaseAuthCookieName } from "../../../lib/server/firebase-server";
import { ApiError } from "../../../lib/shared/errors";
import { serialize } from "cookie";
import { getAppEndpoint } from "../../../lib/domains";

export const log = getLog("firebase");

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
        log.atError().log(`CSRF cookie (${csrfCookie}) doesn't match provided token ${csrfToken}`);
        throw new ApiError("CSRF error", {}, { status: 401 });
      }
      const { cookie, expiresIn } = await createSessionCookie(idToken);
      const options = { maxAge: expiresIn, httpOnly: true, secure, path: "/" };
      res.setHeader("Set-Cookie", serialize(firebaseAuthCookieName, cookie, options));

      return { ok: true };
    },
  },
};

export default nextJsApiHandler(api);
