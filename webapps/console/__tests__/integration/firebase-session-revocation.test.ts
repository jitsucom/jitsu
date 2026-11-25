import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "./support/harness";

// JITSU-297: a Firebase session that was revoked at logout, or whose account is disabled, is refused by the real route
// wrapper on a route that never passed the old revocation flag. Only the Firebase Admin SDK boundary is faked; the route,
// getUser, getFirebaseUser and the database are real.
const fb = vi.hoisted(() => {
  // the Firebase service is created when firebase-server is imported, so the setting has to exist before that
  vi.stubEnv("FIREBASE_AUTH", JSON.stringify({ admin: { project_id: "test" }, client: {} }));
  return { verifySessionCookie: vi.fn(), verifyIdToken: vi.fn(), getUser: vi.fn() };
});
vi.mock("firebase-admin", () => ({
  default: {
    initializeApp: () => ({ auth: () => fb }),
    credential: { cert: (options: unknown) => options },
  },
}));

import workspaceRoute from "../../pages/api/workspace/index";
import meRoute from "../../pages/api/me";

const NOW_S = Math.floor(Date.now() / 1000);
const iso = (seconds: number) => new Date(seconds * 1000).toUTCString();

async function call(handler: any, cookie: string | undefined) {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, any>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
    send(b: any) {
      this.body = b;
      return this;
    },
    setHeader(k: string, v: any) {
      this.headers[k] = v;
    },
    getHeader(k: string) {
      return this.headers[k];
    },
    end() {},
  };
  const req: any = {
    method: "GET",
    url: "/api/workspace",
    headers: { host: "localhost" },
    query: {},
    cookies: cookie ? { "jitsu-auth": cookie } : {},
  };
  await handler(req, res);
  return res;
}

async function sessionOf(seeded: Awaited<ReturnType<typeof seedWorkspace>>, record: Record<string, unknown>) {
  fb.verifySessionCookie.mockResolvedValue({
    uid: seeded.user.externalId,
    email: seeded.user.email,
    email_verified: true,
    auth_time: NOW_S - 3600,
    internalId: seeded.user.internalId,
    firebase: { sign_in_provider: "google.com" },
  });
  fb.getUser.mockResolvedValue({ uid: seeded.user.externalId, displayName: "User", disabled: false, ...record });
}

beforeEach(() => {
  vi.stubEnv("FIREBASE_AUTH", JSON.stringify({ admin: { project_id: "test" }, client: {} }));
  Object.values(fb).forEach(mock => mock.mockReset());
});

describe("a Firebase session on an ordinary authenticated route", () => {
  it("is served while it is valid", async () => {
    const seeded = await seedWorkspace();
    await sessionOf(seeded, { tokensValidAfterTime: iso(NOW_S - 7200) });
    const res = await call(workspaceRoute, "cookie");
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).toContain(seeded.workspace.id);
    // one user lookup per request: the revocation rule reuses the record that is fetched anyway
    expect(fb.getUser).toHaveBeenCalledTimes(1);
  });

  it("is refused with 401 after the account's tokens were revoked at sign-out", async () => {
    const seeded = await seedWorkspace();
    await sessionOf(seeded, { tokensValidAfterTime: iso(NOW_S - 600) });
    const res = await call(workspaceRoute, "cookie");
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.body ?? "")).not.toContain(seeded.workspace.id);
  });

  it("answers /api/me with 'not signed in', not an error, for a cookie of a deleted account", async () => {
    const seeded = await seedWorkspace();
    await sessionOf(seeded, {});
    fb.getUser.mockRejectedValue(Object.assign(new Error("There is no user record"), { code: "auth/user-not-found" }));
    const res = await call(meRoute, "cookie");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ auth: false });
  });

  it("is refused with 401 once the account is disabled", async () => {
    const seeded = await seedWorkspace();
    await sessionOf(seeded, { disabled: true });
    expect((await call(workspaceRoute, "cookie")).statusCode).toBe(401);
  });
});
