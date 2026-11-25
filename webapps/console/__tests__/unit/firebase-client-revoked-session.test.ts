// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { isSessionRevokedError, SESSION_REVOKED } from "../../lib/shared/errors";

// JITSU-297: a browser whose Firebase session was revoked elsewhere (a sign-out on another device, a disabled account) still
// holds a cached ID token. create-session now refuses that token with a 401 that carries SESSION_REVOKED; the client must
// then sign out locally and resolve to "nobody is signed in" (the sign-in page), not reject into an error screen. The real
// useFirebaseSession and resolveUser run; only the Firebase SDK, the HTTP transport and the Jitsu tracker are faked.
const fb = vi.hoisted(() => ({
  rpc: vi.fn(),
  signOut: vi.fn(async () => {}),
  user: undefined as any,
}));
vi.mock("juava", async original => ({ ...(await original<typeof import("juava")>()), rpc: fb.rpc }));
vi.mock("firebase/app", () => ({ getApps: () => [], initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: fb.user }),
  onAuthStateChanged: (_auth: unknown, onUser: (user: unknown) => void) => {
    queueMicrotask(() => onUser(fb.user));
    return () => {};
  },
  signOut: fb.signOut,
  signInWithCustomToken: vi.fn(),
}));
vi.mock("@jitsu/jitsu-react", () => ({ useJitsu: () => ({ analytics: { identify: vi.fn(), track: vi.fn() } }) }));

const { FirebaseProvider, useFirebaseSession } = await import("../../lib/firebase-client");

const firebaseUser = () => ({
  uid: "uid-1",
  email: "user@example.com",
  emailVerified: true,
  displayName: "User",
  photoURL: null,
  providerData: [{ providerId: "google.com" }],
  getIdToken: async () => "cached-id-token",
  getIdTokenResult: async () => ({
    claims: { internalId: "internal-1" },
    expirationTime: new Date(Date.now() + 3_600_000).toISOString(),
  }),
});

function mount() {
  const appConfig = { auth: { firebasePublic: { apiKey: "k" } } } as any;
  return renderHook(useFirebaseSession, {
    wrapper: ({ children }: any) => React.createElement(FirebaseProvider, { appConfig }, children),
  });
}

const revoked = () =>
  Object.assign(new Error("The Firebase session was revoked, sign in again"), { response: { code: SESSION_REVOKED } });

beforeEach(() => {
  fb.rpc.mockReset();
  fb.signOut.mockClear();
  fb.user = firebaseUser();
});
afterEach(cleanup);

describe("isSessionRevokedError", () => {
  it("recognizes only the error that carries the revoked-session code", () => {
    expect(isSessionRevokedError(revoked())).toBe(true);
    expect(isSessionRevokedError(Object.assign(new Error("x"), { response: { code: "other" } }))).toBe(false);
    expect(isSessionRevokedError(new Error("Error 500"))).toBe(false);
    expect(isSessionRevokedError(undefined)).toBe(false);
  });
});

describe("resolveUser when create-session says the session was revoked", () => {
  it("signs out locally and resolves to nobody, so the sign-in page is shown", async () => {
    fb.rpc.mockImplementation(async (url: string) => {
      if (url === "/api/fb-auth/create-session") throw revoked();
      return {};
    });
    const { result } = mount();
    const resolved = await result.current.resolveUser().user;
    expect(resolved).toBeNull();
    expect(fb.signOut).toHaveBeenCalledTimes(1);
    // Changed from "the server-side sign-out is attempted too": the server has already revoked this session (that is why it
    // answered with the code), and /api/fb-auth/revoke-session revokes EVERY session of the account. A request still in
    // flight with an old token can fail after another tab has signed in fresh; calling it then would revoke that new sign-in.
    expect(fb.rpc.mock.calls.map(call => call[0])).not.toContain("/api/fb-auth/revoke-session");
  });

  it("makes no server call but create-session when the session is revoked", async () => {
    // The two-tab case (a fresh sign-in elsewhere, then the old token's request fails) cannot be staged with a faked SDK; what
    // can be pinned is that nothing else reaches the server, so no call can revoke the sessions of the account
    fb.rpc.mockImplementation(async (url: string) => {
      if (url === "/api/fb-auth/create-session") throw revoked();
      return {};
    });
    const { result } = mount();
    await result.current.resolveUser().user;
    const calls = fb.rpc.mock.calls.map(call => call[0]);
    expect(calls).toEqual(["/api/fb-auth/create-session"]);
  });

  it("still rejects for any other failure, so a real error is not mistaken for a sign-out", async () => {
    fb.rpc.mockImplementation(async (url: string) => {
      if (url === "/api/fb-auth/create-session") throw new Error("Error 500 on POST /api/fb-auth/create-session");
      return {};
    });
    const { result } = mount();
    await expect(result.current.resolveUser().user).rejects.toThrow("Error 500");
    expect(fb.signOut).not.toHaveBeenCalled();
  });

  it("returns the user when the session is fine", async () => {
    fb.rpc.mockResolvedValue({});
    const { result } = mount();
    const resolved = await result.current.resolveUser().user;
    expect(resolved?.status).toBe("authenticated");
    expect(fb.signOut).not.toHaveBeenCalled();
  });
});
