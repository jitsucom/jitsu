import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { firebase } from "../../../lib/server/firebase-server";
import { getServerLog } from "../../../lib/server/log";
import { ApiError } from "../../../lib/shared/errors";

const log = getServerLog("firebase-sign-in-methods");

/**
 * Resolves a verified email from a GitHub/Google OAuth access token by
 * calling the provider's own userinfo endpoint — never from client-supplied
 * text. This is the only thing that makes the lookup below safe: anyone can
 * claim any email string, but only someone holding a currently-valid access
 * token for a real account can make the provider's API hand back that
 * account's verified email. A missing/expired/forged token fails here, not
 * at the Firebase lookup, so there is nothing for an attacker to learn from
 * the difference between "no such email" and "wrong token".
 */
async function verifiedEmailFromAccessToken(provider: "github.com" | "google.com", accessToken: string) {
  if (provider === "github.com") {
    const profileRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${accessToken}` },
    });
    if (!profileRes.ok) return undefined;
    const profile = await profileRes.json();
    if (profile.email) return profile.email as string;
    // Same fallback as the primary NextAuth GitHub provider (nextauth.config.ts)
    // — GitHub omits `email` from /user when the primary address is private.
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `token ${accessToken}` },
    });
    if (!emailsRes.ok) return undefined;
    const emails: Array<{ email: string; primary: boolean; verified: boolean }> = await emailsRes.json();
    const primary = emails.find(e => e.primary && e.verified) ?? emails.find(e => e.verified);
    return primary?.email;
  } else {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const profile = await res.json();
    return profile.email_verified ? (profile.email as string) : undefined;
  }
}

/**
 * Finds which Firebase provider(s) an email is already registered under.
 * Used by the account-linking flow (JITSU-244) after Firebase's client SDK
 * throws account-exists-with-different-credential during sign-in.
 *
 * Deliberately does NOT take an email from the client — this project has
 * email-enumeration protection enabled (JITSU-019, see handleFirebaseError),
 * and an endpoint that ran an Admin SDK lookup for any client-supplied email
 * string would be exactly the oracle that protection exists to prevent.
 * Instead it takes the OAuth access token Firebase's own popup flow just
 * produced and independently verifies the email via the provider's API
 * (see verifiedEmailFromAccessToken) before ever touching the Admin SDK.
 */
export const api: Api = {
  url: inferUrl(__filename),
  POST: {
    auth: false,
    allowDuringMaintenance: true,
    types: {
      body: z.object({
        provider: z.enum(["github.com", "google.com"]),
        accessToken: z.string(),
      }),
    },
    handle: async ({ body }) => {
      const email = await verifiedEmailFromAccessToken(body.provider, body.accessToken);
      if (!email) {
        throw new ApiError("Could not verify the provided access token", { status: 401 });
      }
      try {
        const user = await firebase().auth().getUserByEmail(email);
        return { providers: user.providerData.map(p => p.providerId) };
      } catch (err: any) {
        // Only a genuine "no such user" is a legitimate empty result. Any other
        // failure (Admin SDK unavailable, network, etc.) must not be reported
        // the same way — the caller treats an empty list as "no account", and
        // signInWith falls through to Google regardless of the real provider,
        // which is actively misleading for a transient failure rather than a
        // real absence.
        if (err?.code === "auth/user-not-found") {
          return { providers: [] };
        }
        log.atError().withCause(err).log("Error looking up Firebase sign-in methods");
        throw new ApiError("Failed to look up sign-in methods", { status: 500 });
      }
    },
  },
};

export default nextJsApiHandler(api);
