import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { firebase } from "../../../lib/server/firebase-server";
import { getServerLog } from "../../../lib/server/log";

const log = getServerLog("firebase-sign-in-methods");

/**
 * Firebase's own `fetchSignInMethodsForEmail` (client SDK) is unusable here —
 * this project has email-enumeration protection enabled (see JITSU-019 in
 * handleFirebaseError), which makes that client API always return an empty
 * array. This does the same lookup server-side via the Admin SDK (already the
 * pattern `check-email.ts`'s `checkFirebaseUser` uses), which isn't subject
 * to that restriction. Used by the account-linking flow (JITSU-244) to find
 * which provider an email is already registered under, after Firebase has
 * already confirmed — via the account-exists-with-different-credential error
 * that triggered this call — that the email exists.
 */
export const api: Api = {
  url: inferUrl(__filename),
  POST: {
    auth: false,
    allowDuringMaintenance: true,
    types: {
      body: z.object({ email: z.string().email() }),
    },
    handle: async ({ body }) => {
      try {
        const user = await firebase().auth().getUserByEmail(body.email);
        return { providers: user.providerData.map(p => p.providerId) };
      } catch (err: any) {
        if (err?.code !== "auth/user-not-found") {
          log.atError().withCause(err).log("Error looking up Firebase sign-in methods");
        }
        return { providers: [] };
      }
    },
  },
};

export default nextJsApiHandler(api);
