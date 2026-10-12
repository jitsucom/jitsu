import { createContext, PropsWithChildren, useContext } from "react";
import { getApps, initializeApp } from "firebase/app";
import * as auth from "firebase/auth";
import { AppConfig, ContextApiResponse, CreateUserResult } from "./schema";
import { getLog, randomId, requireDefined, rpc } from "juava";
import { useJitsu } from "@jitsu/jitsu-react";

type FirebaseClientSettings = Record<string, any>;
export type FirebaseProviderInstance =
  | { enabled: false; settings?: never }
  | { enabled: true; settings: FirebaseClientSettings };

/**
 * Outcome of resolving the current Firebase user into a Jitsu session. Returned
 * (not thrown) so callers branch on `status` instead of catching control-flow
 * exceptions. Genuine failures (popup closed, network, etc.) still reject.
 *
 * - `authenticated` — a Jitsu user is ready.
 * - `email-not-verified` — a single-provider password account hasn't verified
 *   its email yet (JITSU-018); the caller should show the verification gate.
 * - `personal-email-rejected` — the server refused a personal-email signup and
 *   already deleted the orphaned Firebase account (JITSU-70); the caller should
 *   surface `message` and sign the stale client session out.
 * - `account-exists-different-credential` — the email is already linked to a
 *   different provider (JITSU-244); Firebase refuses to link silently. The
 *   caller should prompt the user to sign in with `existingProviders[0]` and
 *   then pass `pendingCredential` to `linkPendingCredential`.
 */
export type FirebaseAuthResult =
  | { status: "authenticated"; user: ContextApiResponse["user"] }
  | { status: "email-not-verified"; email: string }
  | { status: "personal-email-rejected"; message: string }
  | {
      status: "account-exists-different-credential";
      email: string;
      existingProviders: string[];
      pendingCredential: auth.AuthCredential;
    };

/**
 * `account-exists-different-credential` can only come from an explicit
 * `signInWith`/`linkPendingCredential` call reacting to a popup error —
 * passive session resolution (`resolveUser`, on every page load) never
 * produces it. Excluded here so callers of `resolveUser` don't have to
 * handle a status that can't actually occur for them.
 */
export type PassiveFirebaseAuthResult = Exclude<FirebaseAuthResult, { status: "account-exists-different-credential" }>;

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

  signInWith(type: string): Promise<FirebaseAuthResult>;

  /**
   * Completes the account-linking flow started by a `signInWith` call that
   * returned `account-exists-different-credential`. Must be called only after
   * the caller has re-authenticated via `signInWith(existingProviders[0])` —
   * `linkWithCredential` links to whichever user is currently signed in, so
   * calling this without that re-auth would link the credential to the wrong
   * account. See JITSU-244.
   */
  linkPendingCredential(pendingCredential: auth.AuthCredential): Promise<FirebaseAuthResult>;

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
   * Waits until auth state of the user is resolved. Pass `recordLogin` from an explicit
   * sign-in entry point so the `login` audit/telemetry event fires once internalId is
   * minted; the implicit page-load callers omit it (they must not record a login).
   */
  resolveUser(
    token?: string,
    opts?: { recordLogin?: boolean }
  ): { user: Promise<PassiveFirebaseAuthResult | null>; cleanup: () => void };
}

export function getFirebaseAuth(config: FirebaseClientSettings): typeof auth {
  const app = initializeApp(config.settings);
  return auth;
}

async function getCustomClaim(user: auth.User, claimName: string): Promise<string | undefined> {
  return ((await user.getIdTokenResult()).claims[claimName] as string) || undefined;
}

function getCSRFToken(cookieName: string) {
  const token = randomId({ digits: 100, strongRandom: true });
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

async function getUserFromFirebase(currentUser: auth.User): Promise<PassiveFirebaseAuthResult> {
  const email = requireDefined(currentUser.email, "email of firebase user is undefined");
  // JITSU-018: email+password sign-up issues a valid Firebase JWT before the
  // address is verified. Block such accounts here — before any internal user or
  // session is minted. The gate applies only to single-provider `password`
  // accounts; if Google/GitHub is also linked the address is already trusted.
  const providerData = currentUser.providerData;
  const isPasswordOnly = providerData.length === 1 && providerData[0]?.providerId === "password";
  if (isPasswordOnly && !currentUser.emailVerified) {
    return { status: "email-not-verified", email };
  }
  let internalId = await getCustomClaim(currentUser, "internalId");
  let shouldRefreshToken = false;
  if (!internalId) {
    log.atInfo().log(`Firebase user ${currentUser.uid} / ${email} doesn't have internalId, requesting...`);
    const createResult: CreateUserResult = await rpc(`/api/fb-auth/create-user`, {
      body: {},
      headers: {
        // Force-refresh so the token's email_verified claim is current. The
        // server (JITSU-018) rejects a stale token still carrying
        // email_verified:false for an account that has since verified.
        Authorization: `Bearer ${await currentUser.getIdToken(true)}`,
      },
    });
    // JITSU-70: the server refused a personal-email signup and already deleted
    // the Firebase account. Report it as a result the authorizer / signup
    // handlers branch on.
    if (!createResult.ok && createResult.rejected === "personal-email") {
      return { status: "personal-email-rejected", message: createResult.message };
    }
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
    status: "authenticated",
    user: {
      email,
      externalId: currentUser.uid,
      externalUsername: email,
      image: currentUser.photoURL,
      internalId,
      loginProvider: "firebase/" + currentUser.providerData[0]?.providerId,
      name: currentUser.displayName || email,
    },
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

/**
 * The current user's Firebase ID token, or undefined if nobody is signed in
 * with Firebase. Used to authenticate direct browser calls to ee-api.
 */
export async function getFirebaseIdToken(forceRefresh = false): Promise<string | undefined> {
  if (getApps().length === 0) {
    return undefined;
  }
  const currentUser = auth.getAuth().currentUser;
  return currentUser ? await currentUser.getIdToken(forceRefresh) : undefined;
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
      linkPendingCredential: async () => {
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
    async signInWith(type: string): Promise<FirebaseAuthResult> {
      const provider = type === "github.com" ? new auth.GithubAuthProvider() : new auth.GoogleAuthProvider();
      try {
        try {
          await a.signInWithPopup(a.getAuth(), provider);
        } catch (e: any) {
          // JITSU-244: Firebase refuses to silently link a second provider to an
          // email that already has an account under a different one. Surface it
          // as a result (not a thrown error) so the caller can prompt the user
          // to re-auth with the existing provider and link, instead of just
          // showing a dead-end error message.
          if (e?.code === "auth/account-exists-with-different-credential") {
            const email: string | undefined = e?.customData?.email;
            const pendingCredential =
              type === "github.com"
                ? auth.GithubAuthProvider.credentialFromError(e)
                : auth.GoogleAuthProvider.credentialFromError(e);
            if (email && pendingCredential && pendingCredential.accessToken) {
              // fetchSignInMethodsForEmail (client SDK) always returns [] on this
              // project — email-enumeration protection is enabled (JITSU-019).
              // Look it up server-side instead. The endpoint takes the access
              // token, not the email — it independently verifies the email via
              // the provider's own API rather than trusting client input, so
              // this can't be turned into an email-enumeration oracle. See
              // sign-in-methods.ts for why that distinction matters.
              const signInMethods: { providers: string[] } = await rpc(`/api/fb-auth/sign-in-methods`, {
                body: { provider: type, accessToken: pendingCredential.accessToken },
              });
              const existingProviders = signInMethods.providers;
              // The lookup endpoint now only returns [] for a genuine
              // auth/user-not-found (a narrow race — the error above already
              // means Firebase just confirmed this email has an account; any
              // other failure throws instead of returning an empty list, see
              // sign-in-methods.ts). With no real provider to offer, don't
              // build a prompt around an undefined one — it would default to
              // Google regardless of the actual provider. Fall through to the
              // original error instead.
              if (existingProviders.length > 0) {
                return { status: "account-exists-different-credential", email, existingProviders, pendingCredential };
              }
            }
          }
          throw e;
        }
        const result = await getUserFromFirebase(a.getAuth().currentUser!);
        if (result.status === "authenticated") {
          // Record the login only after getUserFromFirebase has minted/linked the internalId.
          // For a brand-new account the first sign-in reaches /api/fb-auth/audit-login before the
          // profile exists, so it can't resolve internalId and skips both the audit row and the
          // server-side `login` event; ordering it here fixes that (and avoids recording a login
          // for a personal-email signup that getUserFromFirebase rejects). `login` is tracked
          // server-side — see telemetry.trackAuthEvent.
          await recordFirebaseLogin(a.getAuth().currentUser);
          await analytics.identify(result.user.internalId, { email: result.user.email, name: result.user.name });
        }
        return result;
      } catch (e) {
        log.atError().withCause(e).log(`Can't sign in with ${type}`);
        throw e;
      }
    },
    async linkPendingCredential(pendingCredential: auth.AuthCredential): Promise<FirebaseAuthResult> {
      try {
        const currentUser = requireDefined(
          a.getAuth().currentUser,
          "linkPendingCredential called without an active Firebase sign-in"
        );
        await auth.linkWithCredential(currentUser, pendingCredential);
        const result = await getUserFromFirebase(a.getAuth().currentUser!);
        if (result.status === "authenticated") {
          await analytics.identify(result.user.internalId, { email: result.user.email, name: result.user.name });
        }
        return result;
      } catch (e) {
        log.atError().withCause(e).log(`Can't link pending credential`);
        throw e;
      }
    },
    resolveUser(token?: string, opts?: { recordLogin?: boolean }) {
      log.atDebug().log("Authorizing through firebase...");
      const userPromise: Promise<PassiveFirebaseAuthResult | null> = new Promise(async (resolve, reject) => {
        if (token) {
          await auth.signInWithCustomToken(auth.getAuth(), token);
        }
        let unregister = auth.onAuthStateChanged(
          auth.getAuth(),
          async user => {
            log.atDebug().log(`Firebase auth result`, user);
            try {
              const result = user ? await getUserFromFirebase(user) : null;
              // Record the login only for an explicit sign-in (recordLogin) and only after
              // getUserFromFirebase has minted/linked internalId — otherwise a first-time
              // verified password user's login hits /api/fb-auth/audit-login before the
              // profile exists and is dropped. Implicit page-load resolveUser omits recordLogin.
              if (opts?.recordLogin && user && result?.status === "authenticated") {
                await recordFirebaseLogin(user);
              }
              resolve(result);
            } catch (e) {
              // Genuine errors (token mint, network) must reject the outer
              // promise — without this catch the throw escapes the async callback
              // as an unhandled rejection and the caller hangs.
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
      // Note: the `login` event is recorded later, in resolveUser({ recordLogin: true }),
      // once internalId is minted — not here, where a first-time user has no profile yet.
      const userCredential = await auth.signInWithEmailAndPassword(a.getAuth(), username, password);
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
