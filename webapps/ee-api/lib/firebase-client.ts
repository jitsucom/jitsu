/**
 * Browser-side Firebase auth helpers. The Firebase client config is delivered
 * to the page via `getServerSideProps` (see `lib/admin-guard.ts`), so these
 * functions all take it as an argument rather than reading the environment.
 */
import { FirebaseOptions, getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, User } from "firebase/auth";

export type FirebaseClientConfig = FirebaseOptions;

function firebaseAuth(config: FirebaseClientConfig) {
  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}

export async function signInWithGoogle(config: FirebaseClientConfig): Promise<User> {
  const result = await signInWithPopup(firebaseAuth(config), new GoogleAuthProvider());
  return result.user;
}

export async function firebaseSignOut(config: FirebaseClientConfig): Promise<void> {
  await signOut(firebaseAuth(config));
}
