import { beforeEach, describe, expect, it, vi } from "vitest";

// JITSU-297: the routes that accept a Firebase ID token from the client must ask Firebase whether it was revoked at sign-out,
// so that a stolen ID token cannot mint a new 5-day session cookie (create-session) or fake a login event (audit-login).
// Only the Firebase boundary is mocked; the route code and cookie logic are real.
const verifyIdToken = vi.fn();
const createSessionCookie = vi.fn(async (_idToken: string, expiresIn?: number) => ({
  cookie: "cookie",
  expiresIn: expiresIn ?? 5 * 24 * 3600 * 1000,
}));
vi.mock("../../lib/server/firebase-server", async orig => ({
  ...(await orig<any>()),
  firebase: () => ({ auth: () => ({ verifyIdToken }) }),
  createSessionCookie: (...a: any[]) => (createSessionCookie as any)(...a),
}));

const goodToken = { email: "u@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } };

async function createSession() {
  const { api } = await import("../../pages/api/fb-auth/create-session");
  const headers: Record<string, any> = {};
  const res: any = { setHeader: (k: string, v: any) => (headers[k] = v) };
  const req: any = { cookies: { "fb-csrfToken": "x" }, headers: { host: "console.example.com" }, socket: {} };
  try {
    const out = await (api.POST as any).handle({ req, body: { csrfToken: "x", idToken: "tok" }, res });
    return { out, setCookie: headers["Set-Cookie"], error: undefined as any };
  } catch (e: any) {
    return { out: undefined, setCookie: headers["Set-Cookie"], error: e };
  }
}

beforeEach(() => {
  verifyIdToken.mockReset();
  createSessionCookie.mockClear();
});

describe("create-session", () => {
  it("asks Firebase to check revocation when it verifies the ID token", async () => {
    verifyIdToken.mockResolvedValue(goodToken);
    await createSession();
    expect(verifyIdToken).toHaveBeenCalledWith("tok", true);
  });

  it("mints no cookie for an ID token that was revoked at sign-out", async () => {
    verifyIdToken.mockRejectedValue(
      Object.assign(new Error("The Firebase ID token has been revoked."), { code: "auth/id-token-revoked" })
    );
    const r = await createSession();
    expect(r.error).toBeDefined();
    expect(createSessionCookie).not.toHaveBeenCalled();
    expect(r.setCookie).toBeUndefined();
  });
});

describe("audit-login", () => {
  it("asks Firebase to check revocation when it verifies the ID token", async () => {
    verifyIdToken.mockRejectedValue(new Error("revoked"));
    const { api } = await import("../../pages/api/fb-auth/audit-login");
    const req: any = { headers: { host: "console.example.com" }, socket: {} };
    // failures are swallowed by the route (a login must never be blocked by its audit), so only the call is checked
    await (api.POST as any).handle({ req, body: { idToken: "tok" }, res: { setHeader() {} } }).catch(() => undefined);
    expect(verifyIdToken).toHaveBeenCalledWith("tok", true);
  });
});
