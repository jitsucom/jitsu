import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest } from "next";

// JITSU-297: a Firebase session that was revoked at logout (revokeRefreshTokens) or whose account is disabled must be refused
// on every route. Only the Firebase Admin SDK boundary is faked; getFirebaseUser and the revocation rule are real.
const fb = vi.hoisted(() => {
  // the Firebase service is created when firebase-server is imported, so the setting has to exist before that
  vi.stubEnv("FIREBASE_AUTH", JSON.stringify({ admin: { project_id: "test" }, client: {} }));
  return {
    verifySessionCookie: vi.fn(),
    verifyIdToken: vi.fn(),
    getUser: vi.fn(),
  };
});
vi.mock("firebase-admin", () => ({
  default: {
    initializeApp: () => ({ auth: () => fb }),
    credential: { cert: (options: unknown) => options },
  },
}));

import { getFirebaseUser, sessionRejection } from "../../lib/server/firebase-server";

const NOW_S = Math.floor(Date.now() / 1000);
// null leaves auth_time out of the claims (undefined would fall back to the default, and the test would not test the case)
const decoded = (authTime: number | null = NOW_S - 3600) => ({
  uid: "uid-1",
  email: "user@example.com",
  email_verified: true,
  ...(authTime === null ? {} : { auth_time: authTime }),
  internalId: "internal-1",
  firebase: { sign_in_provider: "google.com" },
});
const record = (extra: Record<string, unknown> = {}) => ({
  uid: "uid-1",
  displayName: "User",
  disabled: false,
  ...extra,
});
const iso = (seconds: number) => new Date(seconds * 1000).toUTCString();

const cookieRequest = () =>
  ({ headers: { host: "console.test" }, cookies: { "jitsu-auth": "session-cookie" } } as unknown as NextApiRequest);
const bearerRequest = () =>
  ({ headers: { host: "console.test", authorization: "Bearer id-token" }, cookies: {} } as unknown as NextApiRequest);

beforeEach(() => {
  vi.stubEnv("FIREBASE_AUTH", JSON.stringify({ admin: { project_id: "test" }, client: {} }));
  Object.values(fb).forEach(mock => mock.mockReset());
});

describe("sessionRejection", () => {
  it("accepts a session that started after the last revocation, or when nothing was ever revoked", () => {
    expect(sessionRejection(decoded(NOW_S - 100) as any, record() as any)).toBeUndefined();
    expect(
      sessionRejection(decoded(NOW_S - 100) as any, record({ tokensValidAfterTime: iso(NOW_S - 200) }) as any)
    ).toBeUndefined();
    // the same instant is not revoked: the SDK compares with "older than"
    expect(
      sessionRejection(decoded(NOW_S - 200) as any, record({ tokensValidAfterTime: iso(NOW_S - 200) }) as any)
    ).toBeUndefined();
  });
  it("refuses a session that started before the last revocation", () => {
    expect(
      sessionRejection(decoded(NOW_S - 300) as any, record({ tokensValidAfterTime: iso(NOW_S - 200) }) as any)
    ).toBe("revoked");
  });
  it("refuses a disabled account", () => {
    expect(sessionRejection(decoded() as any, record({ disabled: true }) as any)).toBe("disabled");
  });
  it("fails closed when a revocation exists and the token carries no auth_time", () => {
    expect(sessionRejection(decoded(null) as any, record({ tokensValidAfterTime: iso(NOW_S - 200) }) as any)).toBe(
      "revoked"
    );
  });
});

describe("getFirebaseUser", () => {
  it("accepts a valid session cookie with one user lookup and without the SDK revocation flag", async () => {
    fb.verifySessionCookie.mockResolvedValue(decoded());
    fb.getUser.mockResolvedValue(record({ tokensValidAfterTime: iso(NOW_S - 7200) }));
    const user = await getFirebaseUser(cookieRequest());
    expect(user?.externalId).toBe("uid-1");
    expect(fb.getUser).toHaveBeenCalledTimes(1);
    // the SDK's own check would fetch the user a second time
    expect(fb.verifySessionCookie.mock.calls[0][1]).toBeFalsy();
  });
  it("refuses a session cookie issued before the account's tokens were revoked", async () => {
    fb.verifySessionCookie.mockResolvedValue(decoded(NOW_S - 3600));
    fb.getUser.mockResolvedValue(record({ tokensValidAfterTime: iso(NOW_S - 600) }));
    expect(await getFirebaseUser(cookieRequest())).toBeUndefined();
  });
  it("refuses an ID token issued before the revocation", async () => {
    fb.verifyIdToken.mockResolvedValue(decoded(NOW_S - 3600));
    fb.getUser.mockResolvedValue(record({ tokensValidAfterTime: iso(NOW_S - 600) }));
    expect(await getFirebaseUser(bearerRequest())).toBeUndefined();
  });
  it("treats a deleted account as signed out instead of failing the request", async () => {
    // an unexpired cookie of a deleted account still passes signature verification; the user lookup then fails
    fb.verifySessionCookie.mockResolvedValue(decoded());
    fb.getUser.mockRejectedValue(Object.assign(new Error("There is no user record"), { code: "auth/user-not-found" }));
    expect(await getFirebaseUser(cookieRequest())).toBeUndefined();
  });
  it("does not hide other failures of the user lookup", async () => {
    fb.verifySessionCookie.mockResolvedValue(decoded());
    fb.getUser.mockRejectedValue(Object.assign(new Error("backend unavailable"), { code: "auth/internal-error" }));
    await expect(getFirebaseUser(cookieRequest())).rejects.toThrow("backend unavailable");
  });
  it("refuses a session of a disabled account", async () => {
    fb.verifySessionCookie.mockResolvedValue(decoded());
    fb.getUser.mockResolvedValue(record({ disabled: true }));
    expect(await getFirebaseUser(cookieRequest())).toBeUndefined();
  });
});
