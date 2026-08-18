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
 * Security model:
 * - Same-principal: the token is minted for the cookie's own user, so it
 *   grants nothing the cookie doesn't already carry. The cookie is re-verified
 *   with checkRevoked so a revoked (signed-out) session can't mint fresh
 *   credentials before the cookie expires.
 * - POST, not GET: SameSite=lax never attaches the cookie to cross-site POSTs,
 *   so the endpoint is unreachable via cross-site navigation — the same reason
 *   create-session is safe. allowDuringMaintenance keeps the bridge working on
 *   read-only canaries (create-session uses the same exemption).
 * - The token is tagged `bridge: true`, and create-session REFUSES bridge
 *   tokens: a bridged session can establish client SDK state, but can never
 *   mint a fresh 5-day session cookie from it. This caps what in-page script
 *   on a canary host can do with the bridged credentials — they expire with
 *   the underlying session instead of compounding into new cookies.
 */
export default createRoute()
  .POST({
    auth: true,
    allowDuringMaintenance: true,
    result: z.object({
      token: z.string(),
    }),
  })
  .handler(async ({ req, res, user }) => {
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
    // A bearer-equivalent credential must never be cached by any intermediary.
    res.setHeader("Cache-Control", "no-store");
    // internalId claim as in /api/admin/become (skips the create-user roundtrip
    // client-side); omitted when unset — firebase-admin rejects undefined claim
    // values. `bridge: true` marks the token for the create-session refusal.
    const token = await firebase()
      .auth()
      .createCustomToken(fbUser.externalId, {
        ...(fbUser.internalId ? { internalId: fbUser.internalId } : {}),
        bridge: true,
      });
    return { token };
  })
  .toNextApiHandler();
