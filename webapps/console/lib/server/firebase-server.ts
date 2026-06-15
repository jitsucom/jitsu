import { SessionUser } from "../schema";
import { NextApiRequest } from "next";

import admin from "firebase-admin";
import * as JSON5 from "json5";
import { getErrorMessage, getSingleton, requireDefined, Singleton } from "juava";
import { getServerLog } from "./log";
import { getServerEnv } from "./serverEnv";

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
    getServerLog()
      .atWarn()
      .withCause(e)
      .log(`Failed to verify firebase token: ${getErrorMessage(e)}`);
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
