import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { firebase, getFirebaseUser, isFirebaseEnabled } from "../../../lib/server/firebase-server";
import { ApiError } from "../../../lib/shared/errors";

/**
 * Exchanges the `jitsu-auth` session cookie for a Firebase custom token, so a
 * sibling host that receives the cookie (Domain=AUTH_COOKIE_DOMAIN, e.g.
 * jitsu.com) can establish client-side Firebase SDK state without a fresh
 * sign-in. The SDK persists auth state in per-origin IndexedDB, so a session
 * signed in on use.jitsu.com does not exist on pr<N>.use.jitsu.com even though
 * the cookie is delivered there — this endpoint bridges that gap (JITSU-159,
 * canary deployments).
 *
 * Security: the caller must already hold a valid session cookie — the token is
 * minted for that same user, so this grants no privileges the cookie doesn't
 * already carry. The cookie is re-verified with checkRevoked so a revoked
 * (signed-out) session can't mint fresh credentials even before the cookie
 * expires. GET keeps it exempt from the mutating-request maintenance gate, so
 * the bridge works on read-only canaries.
 */
export default createRoute()
  .GET({
    auth: true,
    result: z.object({
      token: z.string(),
    }),
  })
  .handler(async ({ req, user }) => {
    if (!isFirebaseEnabled()) {
      throw new ApiError("Firebase auth is not enabled", { status: 404 });
    }
    if (user.authType !== "firebase") {
      throw new ApiError("Session bridge is only available for firebase auth", { status: 400 });
    }
    // auth:true has already established the user; re-verify with checkRevoked
    // (the framework check doesn't) before minting sign-in-capable credentials.
    const fbUser = await getFirebaseUser(req, true);
    if (!fbUser) {
      throw new ApiError("Session is revoked or expired", { status: 401 });
    }
    // Same claim shape as /api/admin/become: carry internalId so the client
    // skips the create-user roundtrip. Omit the claim when it's not set (a
    // first-login race) — firebase-admin rejects undefined claim values.
    const token = await firebase()
      .auth()
      .createCustomToken(fbUser.externalId, fbUser.internalId ? { internalId: fbUser.internalId } : undefined);
    return { token };
  })
  .toNextApiHandler();
