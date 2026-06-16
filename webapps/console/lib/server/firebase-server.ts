import { SessionUser } from "../schema";
import { NextApiRequest } from "next";

import admin from "firebase-admin";
import * as JSON5 from "json5";
import { getErrorMessage, getSingleton, requireDefined, Singleton } from "juava";
import { getServerLog } from "./log";
import { getServerEnv } from "./serverEnv";
import { getRequestHost } from "./origin";
import { serialize } from "cookie";

export type FirebaseOptions = {
  admin: any;
  client: any;
};

function parseEnv(envName: string, serverEnv: ReturnType<typeof getServerEnv>) {
  try {
    return JSON5.parse(serverEnv[envName as keyof typeof serverEnv] as string);
  } catch (e) {
    throw new Error(`env ${envName} is not a valid JSON: ${getErrorMessage(e)}`, e as Error);
  }
}

export function getFirebaseOptions(): FirebaseOptions | undefined {
  if (!isFirebaseEnabled()) {
    return undefined;
  }
  const serverEnv = getServerEnv();
  if (serverEnv.FIREBASE_AUTH) {
    return parseEnv("FIREBASE_AUTH", serverEnv);
  } else {
    return {
      admin: parseEnv("FIREBASE_ADMIN", serverEnv),
      client: parseEnv("FIREBASE_CLIENT_CONFIG", serverEnv),
    };
  }
}

export function requireFirebaseOptions(): FirebaseOptions {
  return requireDefined(getFirebaseOptions(), `no env - FIREBASE_AUTH or FIREBASE_ADMIN and FIREBASE_CLIENT_CONFIG`);
}

export function isFirebaseEnabled(): boolean {
  const serverEnv = getServerEnv();
  return !!(serverEnv.FIREBASE_AUTH || (serverEnv.FIREBASE_ADMIN && serverEnv.FIREBASE_CLIENT_CONFIG));
}

export function isGithubEnabled(): boolean {
  const serverEnv = getServerEnv();
  return !!(serverEnv.GITHUB_CLIENT_ID && serverEnv.GITHUB_CLIENT_SECRET);
}

const bearerPrefix = "bearer ";

const firebaseService: Singleton<admin.app.App | undefined> = getSingleton("firebase-service", () => {
  return isFirebaseEnabled()
    ? admin.initializeApp({
        credential: admin.credential.cert(requireFirebaseOptions().admin),
      })
    : undefined;
});

export function firebase(): admin.app.App {
  if (!isFirebaseEnabled()) {
    throw new Error(`firebase() is not available, no env - FIREBASE_AUTH or FIREBASE_ADMIN and FIREBASE_CLIENT_CONFIG`);
  }
  return requireDefined(firebaseService(), `Something went wrong, firebaseService is not initialized`);
}

export const firebaseAuthCookieName = "jitsu-auth";

/**
 * Domain for the Firebase auth cookie, or undefined for a host-only cookie.
 * Host-only is the default — to get it the `Domain` attribute must be omitted
 * entirely, so callers should only set `domain` when this returns a value. When
 * AUTH_COOKIE_DOMAIN is set (e.g. "jitsu.com"), the cookie is shared across that
 * domain's subdomains so sibling apps (e.g. a marketing site) can read the
 * logged-in session. The set and clear paths must use the same value.
 */
export function getAuthCookieDomain(): string | undefined {
  return getServerEnv().AUTH_COOKIE_DOMAIN || undefined;
}

/**
 * Evict the legacy host-scoped auth cookie.
 *
 * Builds before AUTH_COOKIE_DOMAIN set the cookie with an explicit
 * `Domain=<request host>` attribute (e.g. `Domain=use.jitsu.com`). The browser
 * keys that as a different jar entry from today's host-only / parent-domain
 * cookie, so both can coexist and get sent together on the console host — and
 * the stale copy is ordered first, producing a 401 that neither re-login nor
 * the (domain-scoped) logout can clear. This returns a Max-Age=0 Set-Cookie
 * that deletes that legacy entry, so it's evicted on the next login or logout.
 *
 * Returns undefined when the legacy scope coincides with the current canonical
 * scope (e.g. console served directly at AUTH_COOKIE_DOMAIN) — there the legacy
 * delete would clobber the cookie we are setting, so it must be skipped.
 */
export function clearLegacyHostAuthCookie(
  req: NextApiRequest,
  opts: { secure: boolean; canonicalDomain?: string }
): string | undefined {
  // X-Forwarded-Host can be a comma-separated proxy chain — take the first hop —
  // then drop any :port. Bracketed IPv6 / other non-domain hosts are never valid
  // cookie domains; serialize() below rejects them and we skip the clear.
  const legacyDomain = getRequestHost(req)?.split(",")[0]?.trim().split(":")[0];
  // Compare scopes with leading dot stripped + lowercased: browsers treat
  // Domain=.example.com and Domain=example.com as the same cookie (RFC 6265
  // ignores the leading dot), so raw equality could miss the clobber and delete
  // the fresh cookie we just set.
  const normalize = (d?: string) => d?.replace(/^\./, "").toLowerCase();
  if (!legacyDomain || normalize(legacyDomain) === normalize(opts.canonicalDomain)) {
    return undefined;
  }
  try {
    return serialize(firebaseAuthCookieName, "", {
      maxAge: 0,
      httpOnly: true,
      secure: opts.secure,
      path: "/",
      domain: legacyDomain,
    });
  } catch {
    // serialize() rejects malformed domains (odd Host/X-Forwarded-Host formats).
    // This is a best-effort cleanup — never turn login/logout into a 500 over it.
    return undefined;
  }
}

export type FirebaseToken = { idToken: string; cookieToken?: never } | { idToken?: never; cookieToken: string };

export function getFirebaseToken(req: NextApiRequest): FirebaseToken | undefined {
  if (req.headers.authorization && req.headers.authorization.toLowerCase().indexOf(bearerPrefix) === 0) {
    return { idToken: req.headers.authorization.substring(bearerPrefix.length) };
  } else if (req.cookies[firebaseAuthCookieName]) {
    return { cookieToken: req.cookies[firebaseAuthCookieName] };
  } else {
    return undefined;
  }
}

/**
 * Count how many `jitsu-auth` cookies the request actually carries. `req.cookies`
 * collapses duplicate names to the first occurrence, so it can't reveal the
 * duplicate-cookie condition that causes a stale copy to win — only the raw
 * Cookie header can. A count > 1 means two scoped copies coexist (e.g. a legacy
 * Domain=<host> cookie alongside a Domain=<AUTH_COOKIE_DOMAIN> one), which makes
 * the browser send the stale one first. Counts only — never the values, which
 * are bearer session credentials.
 */
export function countAuthCookies(req: NextApiRequest): number {
  const raw = req.headers.cookie;
  if (!raw) {
    return 0;
  }
  return raw.split(";").filter(pair => pair.trim().startsWith(`${firebaseAuthCookieName}=`)).length;
}

/**
 * Request context for auth-failure logs — enough to correlate a 401 with the
 * request without cross-referencing the gateway access logs, plus the
 * duplicate-cookie signal. Contains no secrets.
 */
function authLogContext(req: NextApiRequest): string {
  return `method=${req.method} path=${req.url} host=${getRequestHost(req)} jitsuAuthCookies=${countAuthCookies(req)}`;
}

export async function linkFirebaseUser(firebaseId: string, internalId: string) {
  await firebase().auth().setCustomUserClaims(firebaseId, { internalId });
}

export async function createSessionCookie(idToken: string): Promise<{ cookie; expiresIn }> {
  // Set session expiration to 5 days.
  const expiresIn = 60 * 60 * 24 * 5 * 1000;
  const cookie = await firebase().auth().createSessionCookie(idToken, { expiresIn });
  return { cookie, expiresIn };
}

export async function signOut(firebaseUserId: string): Promise<void> {
  await firebase().auth().revokeRefreshTokens(firebaseUserId);
}

/**
 * JITSU-018: an email+password account whose address is not verified must not
 * receive server-side access. OAuth providers (Google / GitHub) verify the
 * address themselves, so the check is scoped to the `password` sign-in provider.
 * Server-side counterpart of the client gate in firebase-client.tsx.
 */
export function isUnverifiedPasswordAccount(decoded: admin.auth.DecodedIdToken): boolean {
  return decoded.firebase?.sign_in_provider === "password" && decoded.email_verified === false;
}

export async function getFirebaseUser(req: NextApiRequest, checkRevoked?: boolean): Promise<SessionUser | undefined> {
  const authToken = getFirebaseToken(req);
  if (!authToken) {
    // No bearer token and no auth cookie. This is routine for any anonymous hit
    // on an auth:true route (logged-out browsing, pre-sign-in load, bots), so
    // keep it at debug to avoid log spam — a *failed* cookie below is the real
    // anomaly and is logged at warn.
    getServerLog()
      .atDebug()
      .log(`Firebase auth missing — no token or session cookie (${authLogContext(req)})`);
    return undefined;
  }
  //make sure service is initialized
  await firebaseService.waitInit();

  let decodedIdToken;
  try {
    decodedIdToken = authToken.idToken
      ? await firebase().auth().verifyIdToken(authToken.idToken)
      : await firebase()
          .auth()
          .verifySessionCookie(authToken.cookieToken as string, checkRevoked);
  } catch (e) {
    // Context lets a single line explain the 401 (which route, host) and flags
    // the duplicate-cookie case (jitsuAuthCookies>1) that makes a stale copy win.
    getServerLog()
      .atWarn()
      .withCause(e)
      .log(`Failed to verify firebase token: ${getErrorMessage(e)} (${authLogContext(req)})`);
    return;
  }

  // JITSU-018: reject an unverified email+password account even if the
  // client-side gate was bypassed — no session, no internal user.
  if (isUnverifiedPasswordAccount(decodedIdToken)) {
    getServerLog().atWarn().log(`Rejecting unverified email+password account: ${decodedIdToken.email}`);
    return undefined;
  }

  const user = await firebase().auth().getUser(decodedIdToken.uid);

  const email = requireDefined(
    decodedIdToken.email,
    `Malformed firebase token, email is not set: ${JSON.stringify(decodedIdToken)}`
  );
  return {
    name: user.displayName || email,
    email,
    image: decodedIdToken.picture,
    loginProvider: "firebase" + "/" + decodedIdToken.firebase.sign_in_provider,
    externalId: decodedIdToken.uid,
    internalId: decodedIdToken.internalId,
    externalUsername: email,
    authType: "firebase",
  };
}
