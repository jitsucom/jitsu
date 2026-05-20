import { createContext, PropsWithChildren, useContext } from "react";
import { initializeApp } from "firebase/app";
import * as auth from "firebase/auth";
import { AppConfig, ContextApiResponse } from "./schema";
import { getLog, randomId, requireDefined, rpc } from "juava";
import { useJitsu } from "@jitsu/jitsu-react";

type FirebaseClientSettings = Record<string, any>;
export type FirebaseProviderInstance =
  | { enabled: false; settings?: never }
  | { enabled: true; settings: FirebaseClientSettings };

/**
 * Thrown by {@link getUserFromFirebase} when an email+password account signs in
 * before its email address has been verified. OAuth providers (Google, GitHub)
 * verify the address themselves, so the check only applies to the `password`
 * provider. See JITSU-018.
 */
export class EmailNotVerifiedError extends Error {
  readonly email: string;

  constructor(email: string) {
    super(`Email ${email} is not verified`);
    this.name = "EmailNotVerifiedError";
    this.email = email;
  }
}

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

  /**
   * Creates a new email+password Firebase account and sends a verification
   * email. After this resolves the user is signed in but unverified — callers
   * should redirect to a protected route so FirebaseAuthorizer renders
   * VerifyEmailGate. See JITSU-018.
   */
  signUp(email: string, password: string): Promise<void>;

  signInWith(type: string): Promise<void>;

  signOut(): Promise<void>;

  resetPassword(username: string): Promise<void>;

  /**
   * Re-sends the Firebase email-verification message to the signed-in user.
   */
  sendVerificationEmail(): Promise<void>;

  /**
   * Reloads the signed-in user from Firebase and returns whether the email
   * address is now verified. Also refreshes the ID token so its claims are
   * up to date once the address is verified.
   */
  reloadEmailVerified(): Promise<boolean>;

  /** Applies an email-action code (email verification, or email-change recovery). */
  applyActionCode(oobCode: string): Promise<void>;

  /** Verifies a password-reset code and returns the account's email address. */
  verifyPasswordResetCode(oobCode: string): Promise<string>;

  /** Completes a password reset, setting a new password for the code's account. */
  confirmPasswordReset(oobCode: string, newPassword: string): Promise<void>;

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

/**
 * Continue URL for Firebase email actions (verification / reset). After the user
 * completes the action on Firebase's hosted handler, it shows a button back to
 * this URL. Firebase rejects a continue URL whose domain isn't an authorized
 * domain, so it is only set for jitsu.com / localhost origins — dev branch hosts
 * (`*.jitsu.localhost`) fall back to no continue URL.
 */
function emailActionSettings(): auth.ActionCodeSettings | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const { origin, hostname } = window.location;
  if (hostname === "jitsu.com" || hostname.endsWith(".jitsu.com") || hostname === "localhost") {
    return { url: `${origin}/` };
  }
  return undefined;
}

async function getUserFromFirebase(currentUser: auth.User): Promise<ContextApiResponse["user"]> {
  const email = requireDefined(currentUser.email, "email of firebase user is undefined");
  // JITSU-018: email+password sign-up issues a valid Firebase JWT before the
  // address is verified. Block such accounts here — before any internal user or
  // session is minted. The gate applies only to single-provider `password`
  // accounts; if Google/GitHub is also linked the address is already trusted.
  const providerData = currentUser.providerData;
  const isPasswordOnly = providerData.length === 1 && providerData[0]?.providerId === "password";
  if (isPasswordOnly && !currentUser.emailVerified) {
    throw new EmailNotVerifiedError(email);
  }
  let internalId = await getCustomClaim(currentUser, "internalId");
  let shouldRefreshToken = false;
  if (!internalId) {
    log.atInfo().log(`Firebase user ${currentUser.uid} / ${email} doesn't have internalId, requesting...`);
    await rpc(`/api/fb-auth/create-user`, {
      body: {},
      headers: {
        // Force-refresh so the token's email_verified claim is current. The
        // server (JITSU-018) rejects a stale token still carrying
        // email_verified:false for an account that has since verified.
        Authorization: `Bearer ${await currentUser.getIdToken(true)}`,
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

/**
 * Records a Firebase sign-in audit event. Called only from the explicit
 * sign-in entry points (signIn / signInWith) — the implicit cookie-mint
 * path on every page load deliberately doesn't, otherwise the audit log
 * fills up with one "Logged in" row per ID-token refresh.
 *
 * Best-effort: a failure here never blocks the sign-in flow.
 */
async function recordFirebaseLogin(user: auth.User | null) {
  if (!user) return;
  try {
    const idToken = await user.getIdToken();
    await rpc(`/api/fb-auth/audit-login`, { body: { idToken } });
  } catch (e) {
    log.atWarn().withCause(e).log(`Failed to record firebase login`);
  }
}

export async function firebaseSignOut() {
  try {
    await auth.signOut(auth.getAuth());
    await rpc(`/api/fb-auth/revoke-session`);
  } catch (e) {
    log.atWarn().withCause(e).log(`Can't sign out`);
  }
}

export function useFirebaseSession(): FirebaseSession {
  const config = useFirebaseConfig();
  const { analytics } = useJitsu();

  if (!config.enabled) {
    return {
      signIn: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      signUp: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      signInWith: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      signOut: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      resetPassword: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      sendVerificationEmail: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      reloadEmailVerified: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      applyActionCode: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      verifyPasswordResetCode: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      confirmPasswordReset: async () => {
        throw new Error("Firebase auth is not enabled");
      },
      resolveUser: () => {
        throw new Error("Firebase auth is not enabled");
      },
    };
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
        await recordFirebaseLogin(a.getAuth().currentUser);
        const firebaseUser = await getUserFromFirebase(a.getAuth().currentUser!);
        await analytics.identify(firebaseUser.internalId, { email: firebaseUser.email, name: firebaseUser.name });
        await analytics.track("login");
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
            try {
              resolve(user ? await getUserFromFirebase(user) : null);
            } catch (e) {
              // getUserFromFirebase rejecting (e.g. EmailNotVerifiedError) must
              // reject the outer promise — without this catch the throw escapes
              // the async callback as an unhandled rejection and the caller hangs.
              reject(e);
            } finally {
              unregister();
            }
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
      await firebaseSignOut();
    },
    //user: () => (currentUser ? getUserFromFirebase(currentUser) : undefined),
    async signIn(username: string, password): Promise<boolean> {
      const userCredential = await auth.signInWithEmailAndPassword(a.getAuth(), username, password);
      if (userCredential?.user) {
        await recordFirebaseLogin(userCredential.user);
      }
      return !!userCredential?.user;
    },
    async signUp(email: string, password: string): Promise<void> {
      const userCredential = await auth.createUserWithEmailAndPassword(a.getAuth(), email, password);
      if (userCredential?.user) {
        await auth.sendEmailVerification(userCredential.user, emailActionSettings());
      }
    },
    async resetPassword(username: string): Promise<void> {
      await auth.sendPasswordResetEmail(a.getAuth(), username);
    },
    async sendVerificationEmail(): Promise<void> {
      const currentUser = requireDefined(a.getAuth().currentUser, "No signed-in firebase user");
      await auth.sendEmailVerification(currentUser, emailActionSettings());
    },
    async reloadEmailVerified(): Promise<boolean> {
      const currentUser = a.getAuth().currentUser;
      if (!currentUser) {
        return false;
      }
      await currentUser.reload();
      if (currentUser.emailVerified) {
        // Force a token refresh so downstream claims (email_verified) are fresh.
        await currentUser.getIdToken(true);
      }
      return currentUser.emailVerified;
    },
    async applyActionCode(oobCode: string): Promise<void> {
      await auth.applyActionCode(a.getAuth(), oobCode);
    },
    async verifyPasswordResetCode(oobCode: string): Promise<string> {
      return await auth.verifyPasswordResetCode(a.getAuth(), oobCode);
    },
    async confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
      await auth.confirmPasswordReset(a.getAuth(), oobCode, newPassword);
    },
  };
}
