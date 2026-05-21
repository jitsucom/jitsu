/**
 * Browser-side Firebase auth helpers. The Firebase client config is fetched at
 * runtime from `/api/firebase-config` (see components/AuthProvider.tsx), so
 * these functions take it as an argument rather than reading the environment.
 */
import { FirebaseOptions, getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from "firebase/auth";

export type FirebaseClientConfig = FirebaseOptions;

function firebaseAuth(config: FirebaseClientConfig) {
  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}

export async function signInWithGoogle(config: FirebaseClientConfig): Promise<User> {
  const provider = new GoogleAuthProvider();
  // Always show the account chooser so a user can switch accounts.
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(firebaseAuth(config), provider);
  return result.user;
}

export async function firebaseSignOut(config: FirebaseClientConfig): Promise<void> {
  await signOut(firebaseAuth(config));
}

/** Subscribe to Firebase auth state changes. Returns an unsubscribe function. */
export function watchFirebaseAuth(config: FirebaseClientConfig, cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(firebaseAuth(config), cb);
}

/** The current user's Firebase ID token, or null when signed out. */
export async function getIdToken(config: FirebaseClientConfig): Promise<string | null> {
  const user = firebaseAuth(config).currentUser;
  return user ? user.getIdToken() : null;
}
