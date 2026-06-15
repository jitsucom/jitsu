import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import {
  createSessionCookie,
  firebase,
  firebaseAuthCookieName,
  getAuthCookieDomain,
  isUnverifiedPasswordAccount,
} from "../../../lib/server/firebase-server";
import { ApiError } from "../../../lib/shared/errors";
import { SerializeOptions, serialize } from "cookie";
import { getAppEndpoint } from "../../../lib/domains";
import { getServerLog } from "../../../lib/server/log";

const log = getServerLog("firebase");

export const api: Api = {
  url: inferUrl(__filename),
  POST: {
    auth: false,
    // Minting a session cookie from a Firebase ID token does not touch the
    // console DB — keep sign-in working during maintenance so operators
    // aren't locked out while toggling things.
    allowDuringMaintenance: true,
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
      // JITSU-018: never mint a session cookie for an unverified email+password
      // account, even if the client-side gate was bypassed.
      const decodedIdToken = await firebase().auth().verifyIdToken(idToken);
      if (isUnverifiedPasswordAccount(decodedIdToken)) {
        throw new ApiError("Email address is not verified", {}, { status: 403 });
      }
      const { cookie, expiresIn } = await createSessionCookie(idToken);

      // Audit logging lives in /api/fb-auth/audit-login which the client
      // calls only at the actual sign-in moment. This endpoint is hit on
      // every cookie mint / refresh — too noisy to audit here.

      // Host-only by default (no Domain attribute); AUTH_COOKIE_DOMAIN widens it to
      // a parent domain so sibling subdomains share the session.
      const domain = getAuthCookieDomain();
      // Never log the cookie value itself — it's a bearer session credential.
      log.atDebug().log(`Setting firebase auth cookie (domain: ${domain ?? "host-only"}, maxAge: ${expiresIn}ms)`);
      const options: SerializeOptions = {
        maxAge: expiresIn,
        httpOnly: true,
        secure,
        path: "/",
        sameSite: "lax",
        // Omit Domain entirely for a true host-only cookie; only set it when configured.
        ...(domain ? { domain } : {}),
      };
      res.setHeader("Set-Cookie", serialize(firebaseAuthCookieName, cookie, options));

      return { ok: true };
    },
  },
};

export default nextJsApiHandler(api);
