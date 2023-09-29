import { NextApiRequest, NextApiResponse } from "next";
import { getErrorMessage, getSingleton, requireDefined, Singleton } from "juava";

import * as admin from "firebase-admin";
import * as JSON5 from "json5";
import { getServerLog } from "./log";

const bearerPrefix = "bearer ";

export const firebaseAuthCookieName = "fb-auth2";

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

export function getFirebaseToken(req: NextApiRequest): FirebaseToken | undefined {
  if (req.headers.authorization && req.headers.authorization.toLowerCase().indexOf(bearerPrefix) === 0) {
    return { idToken: req.headers.authorization.substring(bearerPrefix.length) };
  } else if (req.cookies[firebaseAuthCookieName]) {
    return { cookieToken: req.cookies[firebaseAuthCookieName] };
  } else {
    return undefined;
  }
}

export async function getFirebaseUser(req: NextApiRequest): Promise<FirebaseAuthClaim | undefined> {
  const authToken = getFirebaseToken(req);
  if (!authToken) {
    return undefined;
  }
  //make sure service is initialized
  await firebaseService.waitInit();

  const decodedIdToken = authToken.idToken
    ? await firebase().auth().verifyIdToken(authToken.idToken)
    : await firebase()
        .auth()
        .verifySessionCookie(authToken.cookieToken as string);
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

export async function createCustomToken(req: NextApiRequest): Promise<string> {
  const authToken = requireDefined(getFirebaseToken(req), `Not authorized`);

  //make sure service is initialized
  await firebaseService.waitInit();

  const decodedIdToken = authToken.idToken
    ? await firebase().auth().verifyIdToken(authToken.idToken)
    : await firebase()
        .auth()
        .verifySessionCookie(authToken.cookieToken as string);
  const user = await firebase().auth().getUser(decodedIdToken.uid);

  return firebase()
    .auth()
    .createCustomToken(decodedIdToken.uid, { email: user.email, name: user.displayName, ...user.customClaims });
}
