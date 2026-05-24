import { NextApiRequest, NextApiResponse } from "next";
import { getErrorMessage, getSingleton, requireDefined, Singleton } from "juava";

import admin from "firebase-admin";
import * as JSON5 from "json5";
import { getServerLog } from "./log";

export const firebaseAuthCookieName = "fb-auth2";

/**
 * Header used by both the console server (forwarding the signed-in user's
 * Firebase credential) and the browser (sending its own ID token directly).
 * Reserved for Firebase; `Authorization: Bearer` is for system tokens —
 * see `lib/auth.ts`.
 */
export const firebaseTokenHeader = "x-fb-auth";

export type FirebaseToken = { idToken: string; cookieToken?: never } | { idToken?: never; cookieToken: string };

const log = getServerLog("firebase-auth");

export type FirebaseOptions = {
  admin: any;
  client: any;
};

function parseEnv(envName: string) {
  try {
    return JSON5.parse(process.env[envName] as string);
  } catch (e) {
    throw new Error(`env ${envName} is not a valid JSON: ${getErrorMessage(e)}`, e as Error);
  }
}

export function getFirebaseOptions(): FirebaseOptions | undefined {
  if (!isFirebaseEnabled()) {
    return undefined;
  }
  if (process.env.FIREBASE_AUTH) {
    return parseEnv("FIREBASE_AUTH");
  } else {
    return {
      admin: parseEnv("FIREBASE_ADMIN"),
      client: parseEnv("FIREBASE_CLIENT_CONFIG"),
    };
  }
}

export function requireFirebaseOptions(): FirebaseOptions {
  return requireDefined(getFirebaseOptions(), `no env - FIREBASE_AUTH or FIREBASE_ADMIN and FIREBASE_CLIENT_CONFIG`);
}

export function isFirebaseEnabled(): boolean {
  return !!(process.env.FIREBASE_AUTH || (process.env.FIREBASE_ADMIN && process.env.FIREBASE_CLIENT_CONFIG));
}

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

/**
 * Pick the Firebase credential off a request. The `x-fb-auth` header is the
 * one channel both the browser (ID token) and the console SSR layer (session
 * cookie value forwarded as a string) write to — we can't tell which without
 * trying. The `fb-auth2` cookie is the alternative when the admin UI hits its
 * own ee-api endpoints. `Authorization: Bearer` is intentionally NOT read
 * here — that header is reserved for system tokens (`lib/auth.ts`).
 */
export function getFirebaseToken(req: NextApiRequest): FirebaseToken | undefined {
  const headerVal = req.headers[firebaseTokenHeader];
  const headerToken = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (headerToken) {
    // Could be either shape — `verifyFirebaseToken` tries both.
    return { idToken: headerToken };
  } else if (req.cookies[firebaseAuthCookieName]) {
    return { cookieToken: req.cookies[firebaseAuthCookieName] };
  } else {
    return undefined;
  }
}

/**
 * Verify whatever `getFirebaseToken` produced. Header values may be either an
 * ID token or a session cookie value (console SSR forwards the cookie as a
 * string), so on the header path we try ID first and fall back to cookie.
 */
export async function verifyFirebaseToken(token: FirebaseToken): Promise<admin.auth.DecodedIdToken> {
  if (token.cookieToken) {
    return verifyFirebaseSessionCookie(token.cookieToken);
  }
  try {
    return await verifyIdToken(token.idToken as string);
  } catch (e) {
    return verifyFirebaseSessionCookie(token.idToken as string);
  }
}

export async function getFirebaseUser(req: NextApiRequest): Promise<FirebaseAuthClaim | undefined> {
  const authToken = getFirebaseToken(req);
  if (!authToken) {
    return undefined;
  }
  const decodedIdToken = await verifyFirebaseToken(authToken);
  log.atInfo().log(`decodedIdToken: ${JSON.stringify(decodedIdToken)}`);
  const email = requireDefined(
    decodedIdToken.email,
    `Malformed firebase token, email is not set: ${JSON.stringify(decodedIdToken)}`
  );
  return {
    uid: decodedIdToken.uid,
    email: email,
  };
}

type FirebaseAuthClaim = {
  uid: string;
  email: string;
};

export async function auth(req: NextApiRequest, res: NextApiResponse): Promise<FirebaseAuthClaim | undefined> {
  try {
    const user = await getFirebaseUser(req);
    if (user) {
      return user;
    } else {
      res.status(401).json({ ok: false, error: `Invalid JWT token. Code: MAYBE_EXPIRED` });
      return undefined;
    }
  } catch (e) {
    log.atError().withCause(e).log(`Failed to decrypt token: ${e}`);
    res.status(401).json({ ok: false, error: `Invalid JWT token. Code: DECRYPT_EXCEPTION` });
    return undefined;
  }
}

// `checkRevoked: true` makes the Admin SDK additionally reject tokens whose
// session was revoked (sign-out / password reset) and tokens of a disabled
// user. It costs one extra lookup of the user record per call — acceptable for
// ee-api's admin/billing traffic, and it means a signed-out user can't keep
// hitting ee-api with a still-unexpired session cookie (up to 5 days).

/** Verify a Firebase ID token (issued by the client SDK after sign-in). */
export async function verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
  await firebaseService.waitInit();
  return firebase().auth().verifyIdToken(idToken, true);
}

/** Verify a Firebase session cookie. */
export async function verifyFirebaseSessionCookie(cookieToken: string): Promise<admin.auth.DecodedIdToken> {
  await firebaseService.waitInit();
  return firebase().auth().verifySessionCookie(cookieToken, true);
}

export async function createCustomToken(req: NextApiRequest): Promise<string> {
  const authToken = requireDefined(getFirebaseToken(req), `Not authorized`);
  const decodedIdToken = await verifyFirebaseToken(authToken);
  const user = await firebase().auth().getUser(decodedIdToken.uid);

  return firebase()
    .auth()
    .createCustomToken(decodedIdToken.uid, { email: user.email, name: user.displayName, ...user.customClaims });
}
