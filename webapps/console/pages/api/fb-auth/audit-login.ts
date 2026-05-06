import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { firebase } from "../../../lib/server/firebase-server";
import { db } from "../../../lib/server/db";
import { authAuditLog } from "../../../lib/server/audit-log";
import { getServerLog } from "../../../lib/server/log";

const log = getServerLog("firebase-audit-login");

/**
 * Records a Firebase sign-in audit event. Called from the client only at
 * the actual sign-in moment (signIn / signInWith), not from the implicit
 * cookie-mint path used on every page load. Auth is via the supplied
 * idToken in the body — at the call site the user has just authed but
 * may not yet have a session cookie.
 */
export const api: Api = {
  url: inferUrl(__filename),
  POST: {
    auth: false,
    types: {
      body: z.object({ idToken: z.string() }),
    },
    handle: async ({ body }) => {
      try {
        const decoded = await firebase().auth().verifyIdToken(body.idToken);
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
        log
          .atError()
          .withCause(err as Error)
          .log("Failed to record firebase login audit event");
      }
      return { ok: true };
    },
  },
};

export default nextJsApiHandler(api);
