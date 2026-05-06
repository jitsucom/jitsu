import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { createSessionCookie, firebase, firebaseAuthCookieName } from "../../../lib/server/firebase-server";
import { ApiError } from "../../../lib/shared/errors";
import { SerializeOptions, serialize } from "cookie";
import { getAppEndpoint } from "../../../lib/domains";
import { getRequestHost } from "../../../lib/server/origin";
import { getServerLog } from "../../../lib/server/log";
import { getLog } from "juava";
import { authAuditLog } from "../../../lib/server/audit-log";
import { db } from "../../../lib/server/db";

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

      // Audit-log a successful login. Decode the idToken to get the user identity;
      // failure here must never break login.
      try {
        const decoded = await firebase().auth().verifyIdToken(idToken);
        const email = decoded.email || "";
        let internalId = (decoded as any).internalId as string | undefined;
        if (!internalId && email) {
          const profile = await db
            .prisma()
            .userProfile.findFirst({ where: { externalId: decoded.uid, loginProvider: "firebase" } });
          internalId = profile?.id;
        }
        if (internalId) {
          await authAuditLog({ internalId, email, name: decoded.name || email }, "login", "firebase");
        }
      } catch (err) {
        log.atError().withCause(err as Error).log("Failed to record firebase login audit event");
      }

      //we need to split() since the domain might contain a port, not good for cookies
      const domain = getRequestHost(req).split(":")[0];
      getLog().atDebug().log(`Setting firebase auth cookie for '${domain}': ${cookie}`);
      const options: SerializeOptions = {
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
