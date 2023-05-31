import { createContext, PropsWithChildren, useContext } from "react";
import { initializeApp } from "firebase/app";
import * as auth from "firebase/auth";
import { AppConfig, ContextApiResponse } from "./schema";
import { getLog, randomId, requireDefined, rpc } from "juava";

type FirebaseClientSettings = Record<string, any>;
export type FirebaseProviderInstance =
  | { enabled: false; settings?: never }
  | { enabled: true; settings: FirebaseClientSettings };

const FirebaseContext = createContext<FirebaseProviderInstance | null>(null);

const log = getLog("firebase");
export const FirebaseProvider: React.FC<PropsWithChildren<{ appConfig: AppConfig }>> = ({ appConfig, children }) => {
  return (
    <FirebaseContext.Provider
      value={
        appConfig.auth?.firebasePublic
          ? { enabled: true, settings: appConfig.auth?.firebasePublic }
          : { enabled: false }
      }
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebaseConfig(): FirebaseClientSettings {
  return useContext(FirebaseContext) || { enabled: false };
}

export interface FirebaseSession {
  signIn(username: string, password): Promise<boolean>;

  signInWith(type: string): Promise<void>;

  signOut(): Promise<void>;

  resetPassword(username: string): Promise<void>;

  /**
   * Waits until auth state of the user is resolved
   */
  resolveUser(token?: string): { user: Promise<ContextApiResponse["user"] | null>; cleanup: () => void };
}

export function getFirebaseAuth(config: FirebaseClientSettings): typeof auth {
  const app = initializeApp(config.settings);
  return auth;
}

async function getCustomClaim(user: auth.User, claimName: string): Promise<string | undefined> {
  return ((await user.getIdTokenResult()).claims[claimName] as string) || undefined;
}

function getCSRFToken(cookieName: string) {
  const token = randomId(100);
  document.cookie = `${cookieName}=${token}; expires=0; path=/`;
  return token;
}

async function getUserFromFirebase(currentUser: auth.User): Promise<ContextApiResponse["user"]> {
  const email = requireDefined(currentUser.email, "email of firebase user is undefined");
  let internalId = await getCustomClaim(currentUser, "internalId");
  let shouldRefreshToken = false;
  if (!internalId) {
    log.atInfo().log(`Firebase user ${currentUser.uid} / ${email} doesn't have internalId, requesting...`);
    await rpc(`/api/fb-auth/create-user`, {
      body: {},
      headers: {
        Authorization: `Bearer ${await currentUser.getIdToken()}`,
      },
    });
    const newToken = await currentUser.getIdTokenResult(true);
    internalId = newToken.claims.internalId as string;
    log.atDebug().log(`Refreshed firebase token`, newToken);
    currentUser = auth.getAuth().currentUser!;
    log.atDebug().log(`Refreshed firebase user`, currentUser);
    shouldRefreshToken = true;
  }
  const idToken = await currentUser.getIdToken(shouldRefreshToken);
  const decodedIdToken = await currentUser.getIdTokenResult(false);
  const csrfToken = getCSRFToken("fb-csrfToken");
  await rpc(`/api/fb-auth/create-session`, {
    body: {
      csrfToken,
      idToken,
    },
  });
  const expirationTime = new Date(decodedIdToken.expirationTime);
  const expirationMs = expirationTime.getTime() - Date.now();
  log.atDebug().log(`Firebase token expires in ${expirationMs / (1000 * 60)}min, at ${expirationTime.toISOString()}`);

  return {
    email,
    externalId: currentUser.uid,
    externalUsername: email,
    image: currentUser.photoURL,
    internalId,
    loginProvider: "firebase/" + currentUser.providerData[0]?.providerId,
    name: currentUser.displayName || email,
  };
}

export async function firebaseSignOut() {
  try {
    await auth.signOut(auth.getAuth());
  } catch (e) {
    log.atWarn().withCause(e).log(`Can't sign out`);
  }
}

export function useFirebaseSession(): FirebaseSession {
  const config = useFirebaseConfig();

  if (!config.enabled) {
    throw new Error(`Firebase is not enabled, exiting`);
  }
  const a = getFirebaseAuth(config);

  return {
    async signInWith(type: string): Promise<void> {
      try {
        let user;
        if (type === "github.com") {
          user = await a.signInWithPopup(a.getAuth(), new auth.GithubAuthProvider());
        } else {
          user = await a.signInWithPopup(a.getAuth(), new auth.GoogleAuthProvider());
        }
        await getUserFromFirebase(a.getAuth().currentUser!);
      } catch (e) {
        log.atError().withCause(e).log(`Can't sign in with ${type}`);
        throw e;
      }
    },
    resolveUser(token?: string) {
      log.atDebug().log("Authorizing through firebase...");
      const userPromise: Promise<ContextApiResponse["user"] | null> = new Promise(async (resolve, reject) => {
        if (token) {
          await auth.signInWithCustomToken(auth.getAuth(), token);
        }
        let unregister = auth.onAuthStateChanged(
          auth.getAuth(),
          async user => {
            log.atDebug().log(`Firebase auth result`, user);
            resolve(user ? await getUserFromFirebase(user) : null);
            unregister();
          },
          error => {
            log.atError().withCause(error).log(`Firebase auth error`);
            reject(error);
          }
        );
      });
      return {
        user: userPromise,
        cleanup: () => {
          /* to do */
        },
      };
    },
    async signOut(): Promise<void> {
      await a.signOut(a.getAuth());
    },
    //user: () => (currentUser ? getUserFromFirebase(currentUser) : undefined),
    async signIn(username: string, password): Promise<boolean> {
      const userCredential = await auth.signInWithEmailAndPassword(a.getAuth(), username, password);
      return !!userCredential?.user;
    },
    async resetPassword(username: string): Promise<void> {
      await auth.sendPasswordResetEmail(a.getAuth(), username);
    },
  };
}
