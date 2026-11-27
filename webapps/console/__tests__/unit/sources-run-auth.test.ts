import { beforeEach, describe, expect, it, vi } from "vitest";

// Test value for this file only: the route reads the key when the module is loaded
const SYNCCTL_KEY = vi.hoisted(() => {
  const key = "test-syncctl-key-0123456789";
  vi.stubEnv("SYNCCTL_AUTH_KEY", key);
  return key;
});

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  runSync: vi.fn(),
  safeEqual: vi.fn(),
}));

vi.mock("../../lib/server/db", () => ({ db: { prisma: () => ({}) } }));
vi.mock("../../lib/server/maintenance", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/server/maintenance")>()),
  isReadOnly: () => false,
  isMaintenanceActive: () => false,
}));
vi.mock("../../lib/api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  getUser: mocks.getUser,
}));
vi.mock("../../lib/server/route-services", () => ({ syncService: () => ({ runSync: mocks.runSync }) }));
vi.mock("juava", async importOriginal => {
  const original = await importOriginal<typeof import("juava")>();
  mocks.safeEqual.mockImplementation(original.safeEqual);
  return { ...original, safeEqual: mocks.safeEqual };
});

import handler from "../../pages/api/[workspaceId]/sources/run";

// A call with the SYNCCTL_AUTH_KEY bearer is the legacy scheduler: it skips the user check and is ignored. Any other
// request needs a user. The key is compared in constant time (a compare with !== tells, by its time, how many leading
// characters of the key were right).
async function call(authorization: string | undefined) {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    sent: false,
    status(code: number) {
      if (!this.sent) this.statusCode = code;
      return this;
    },
    send(b: any) {
      if (!this.sent) this.body = b;
      this.sent = true;
      return this;
    },
    json(b: any) {
      return this.send(b);
    },
    setHeader() {},
    getHeader() {},
    end() {},
  };
  await handler(
    {
      method: "GET",
      headers: authorization === undefined ? {} : { authorization },
      query: { workspaceId: "w1", syncId: "s1" },
      cookies: {},
      url: "/",
    } as any,
    res
  );
  return res;
}

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.runSync.mockReset();
  mocks.safeEqual.mockClear();
});

describe("GET /api/[workspaceId]/sources/run key check", () => {
  it("compares the presented key with the configured one through safeEqual", async () => {
    await call(`Bearer ${SYNCCTL_KEY}`);
    expect(mocks.safeEqual).toHaveBeenCalledWith(SYNCCTL_KEY, SYNCCTL_KEY);
  });

  it("lets the right key in as the scheduler: no user lookup, nothing run", async () => {
    const res = await call(`Bearer ${SYNCCTL_KEY}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it("sends every other request to the user check, and refuses it without a user", async () => {
    mocks.getUser.mockResolvedValue(undefined);
    for (const authorization of [
      undefined,
      "",
      "Bearer ",
      `Bearer ${SYNCCTL_KEY.slice(0, -1)}x`,
      `Bearer x${SYNCCTL_KEY.slice(1)}`,
      `Bearer ${SYNCCTL_KEY.slice(0, -1)}`,
      `Bearer ${SYNCCTL_KEY}x`,
      "Bearer wrong",
      SYNCCTL_KEY.toUpperCase(),
    ]) {
      mocks.getUser.mockClear();
      const res = await call(authorization);
      expect(mocks.getUser, String(authorization)).toHaveBeenCalledTimes(1);
      expect(res.statusCode, String(authorization)).toBe(401);
      expect(mocks.runSync).not.toHaveBeenCalled();
    }
  });

  it("still runs the sync for a signed-in user whose key is wrong", async () => {
    mocks.getUser.mockResolvedValue({ internalId: "u1", email: "u@example.com" });
    mocks.runSync.mockResolvedValue({ ok: true, taskId: "t1", status: "s", logs: "l" });
    await call("Bearer wrong");
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
  });
});
