import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { FirebaseClientConfig, firebaseSignOut, signInWithGoogle, watchFirebaseAuth } from "../lib/firebase-client";

/**
 * Client-side auth for the admin UI.
 *
 *  - `loading`   — resolving Firebase config / auth state.
 *  - `anon`      — not signed in (or Firebase not configured).
 *  - `forbidden` — signed in, but not on the JITSU_EE_ADMINS allow-list.
 *  - `admin`     — signed in and authorized.
 *
 * Authorization is verified server-side via `/api/admin/whoami` — the client
 * state here only drives what UI to show; API endpoints enforce access
 * independently with `withFirebaseAdminAuth`.
 */
type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "forbidden"; email: string }
  | { status: "admin"; email: string };

type AuthContextValue = AuthState & {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}

export const AuthProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const configRef = useRef<FirebaseClientConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    (async () => {
      let config: FirebaseClientConfig | null = null;
      try {
        const resp = await fetch("/api/firebase-config");
        const body = await resp.json();
        config = body.enabled ? body.config : null;
      } catch {
        config = null;
      }
      if (cancelled) {
        return;
      }
      if (!config) {
        setState({ status: "anon" });
        return;
      }
      configRef.current = config;

      unsubscribe = watchFirebaseAuth(config, async (user: User | null) => {
        if (cancelled) {
          return;
        }
        if (!user) {
          setState({ status: "anon" });
          return;
        }
        try {
          const idToken = await user.getIdToken();
          const resp = await fetch("/api/admin/whoami", { headers: { Authorization: `Bearer ${idToken}` } });
          if (cancelled) {
            return;
          }
          if (resp.ok) {
            const { email } = await resp.json();
            setState({ status: "admin", email: email || user.email || "" });
          } else {
            setState({ status: "forbidden", email: user.email || "" });
          }
        } catch {
          if (!cancelled) {
            setState({ status: "forbidden", email: user.email || "" });
          }
        }
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    const config = configRef.current;
    if (!config) {
      throw new Error("Firebase auth is not configured");
    }
    await signInWithGoogle(config);
    // watchFirebaseAuth fires next and verifies admin status; show a spinner
    // meanwhile rather than the stale signed-out UI.
    setState({ status: "loading" });
  }, []);

  const signOut = useCallback(async () => {
    if (configRef.current) {
      await firebaseSignOut(configRef.current);
    }
    // watchFirebaseAuth fires with null and sets `anon`.
  }, []);

  return <AuthContext.Provider value={{ ...state, signIn, signOut }}>{children}</AuthContext.Provider>;
};
