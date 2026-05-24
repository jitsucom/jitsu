import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  FirebaseClientConfig,
  firebaseSignOut,
  getIdToken,
  signInWithGoogle,
  watchFirebaseAuth,
} from "../lib/firebase-client";

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
  /** `fetch` with the caller's Firebase ID token attached as a Bearer header. */
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
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
          // `Authorization: Bearer` is reserved for system tokens on the API
          // side; Firebase credentials always travel as `x-fb-auth`.
          const resp = await fetch("/api/admin/whoami", { headers: { "x-fb-auth": idToken } });
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

  const authFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const config = configRef.current;
    const token = config ? await getIdToken(config) : null;
    const headers = new Headers(init?.headers);
    if (token) {
      // See whoami fetch above — Firebase ID token goes in `x-fb-auth`.
      headers.set("x-fb-auth", token);
    }
    return fetch(input, { ...init, headers });
  }, []);

  return <AuthContext.Provider value={{ ...state, signIn, signOut, authFetch }}>{children}</AuthContext.Provider>;
};
