import { describe, it, expect, vi, beforeEach } from "vitest";
import { deps, seedWorkspace } from "./support/harness";

// JITSU-256: the session cookie of an impersonation ends at the original deadline, and its Max-Age is in seconds.
// Only the Firebase boundary is mocked; the route code, cookie logic and the audit table are real.
let decoded: any = {};
const createSessionCookie = vi.fn(async (idToken: string, expiresIn?: number) => ({
  cookie: "cookie-for-" + idToken,
  expiresIn: expiresIn ?? 5 * 24 * 3600 * 1000,
}));
vi.mock("../../lib/server/firebase-server", async orig => ({
  ...(await orig<any>()),
  firebase: () => ({ auth: () => ({ verifyIdToken: async () => decoded }) }),
  createSessionCookie: (...a: any[]) => (createSessionCookie as any)(...a),
}));

const NOW = Date.now();
const secondsAgo = (s: number) => Math.floor((NOW - s * 1000) / 1000);
async function call(claims: any) {
  decoded = { email: "u@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" }, ...claims };
  const { api } = await import("../../pages/api/fb-auth/create-session");
  const headers: Record<string, any> = {};
  const res: any = { setHeader: (k: string, v: any) => (headers[k] = v) };
  const req: any = { cookies: { "fb-csrfToken": "x" }, headers: { host: "console.example.com" }, socket: {} };
  try {
    const out = await (api.POST as any).handle({ req, body: { csrfToken: "x", idToken: "tok" }, res });
    return { out, setCookie: headers["Set-Cookie"] as string[] | undefined, error: undefined as any };
  } catch (e: any) {
    return { out: undefined, setCookie: undefined, error: e };
  }
}
const maxAge = (r: { setCookie?: string[] }) => Number(/Max-Age=(\d+)/.exec(r.setCookie?.[0] ?? "")?.[1]);

describe("create-session with impersonation (JITSU-256), Firebase mocked", () => {
  beforeEach(() => createSessionCookie.mockClear());

  it("an ordinary session still gets the 5-day cookie", async () => {
    const r = await call({ auth_time: secondsAgo(3600 * 24) });
    expect(createSessionCookie).toHaveBeenCalledWith("tok", undefined);
    expect(maxAge(r)).toBe(5 * 24 * 3600);
  });
  it("a fresh impersonation gets a cookie that ends at auth_time + 1h", async () => {
    const r = await call({ auth_time: secondsAgo(10 * 60), impersonatedBy: "admin1" });
    const asked = createSessionCookie.mock.calls[0][1] as number;
    expect(asked).toBeGreaterThan(49 * 60_000);
    expect(asked).toBeLessThanOrEqual(50 * 60_000);
    expect(maxAge(r)).toBeGreaterThan(49 * 60);
    expect(maxAge(r)).toBeLessThanOrEqual(50 * 60);
  });
  it("a refresh at minute 50 does NOT get a fresh hour", async () => {
    const r = await call({ auth_time: secondsAgo(50 * 60), impersonatedBy: "admin1" });
    const asked = createSessionCookie.mock.calls[0][1] as number;
    expect(asked).toBeLessThanOrEqual(10 * 60_000);
    expect(asked).toBeGreaterThan(9 * 60_000);
    expect(maxAge(r)).toBeGreaterThan(9 * 60);
    expect(maxAge(r)).toBeLessThanOrEqual(10 * 60);
  });
  it("under Firebase's 5-minute minimum no new cookie is set, and the call still succeeds", async () => {
    const r = await call({ auth_time: secondsAgo(57 * 60), impersonatedBy: "admin1" });
    expect(r.out).toEqual({ ok: true });
    expect(createSessionCookie).not.toHaveBeenCalled();
    expect(r.setCookie).toBeUndefined();
  });
  it.each([
    ["61 minutes old", secondsAgo(61 * 60)],
    ["a day old", secondsAgo(86400)],
    ["missing auth_time", undefined],
  ])("%s -> 401 and no cookie", async (_, auth_time) => {
    const r = await call({ auth_time, impersonatedBy: "admin1" });
    expect(r.error?.status).toBe(401);
    expect(createSessionCookie).not.toHaveBeenCalled();
  });
  it("an impersonation token that claims impersonatedBy:false-ish values is treated as ordinary", async () => {
    await call({ auth_time: secondsAgo(86400 * 2), impersonatedBy: "" });
    expect(createSessionCookie).toHaveBeenCalledWith("tok", undefined);
  });
});

describe("impersonation audit row (real Postgres)", () => {
  it("writes an auth-impersonate row with security severity, the admin and the target", async () => {
    vi.resetModules();
    vi.stubEnv("CONSOLE_ENABLE_AUDIT_LOG", "true");
    const { impersonationAuditLog } = await import("../../lib/server/audit-log");
    const { user } = await seedWorkspace({ admin: true });
    const target = `target-${Date.now()}`;
    await impersonationAuditLog(
      { internalId: user.internalId, email: user.email, authType: "firebase" },
      { externalId: "ext-1", internalId: target, email: "victim@example.com" }
    );
    const rows = await deps().prisma.auditLog.findMany({ where: { type: "auth-impersonate", objectId: target } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: "security", userId: user.internalId, authType: "firebase" });
    expect((rows[0].changes as any).targetEmail).toBe("victim@example.com");
    vi.unstubAllEnvs();
  });
});
