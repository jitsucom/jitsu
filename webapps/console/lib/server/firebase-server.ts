import { SessionUser } from "../schema";
import { NextApiRequest } from "next";

import * as admin from "firebase-admin";
import * as JSON5 from "json5";
import { getErrorMessage, getSingleton, requireDefined, Singleton } from "juava";
import { getServerLog } from "./log";

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

export const firebaseAuthCookieName = "fb-auth2";

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

export async function getFirebaseUser(req: NextApiRequest, checkRevoked?: boolean): Promise<SessionUser | undefined> {
  const authToken = getFirebaseToken(req);
  if (!authToken) {
    return undefined;
  }
  //make sure service is initialized
  await firebaseService.waitInit();

  getServerLog()
    .atDebug()
    .log(`authToken (${(checkRevoked = !!checkRevoked)}): ${JSON.stringify(authToken)}`);

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
  };
}
