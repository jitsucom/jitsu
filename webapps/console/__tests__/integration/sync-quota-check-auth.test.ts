import { describe, expect, it, vi } from "vitest";

// A test value for this file only: the route reads it when the module is loaded
const SYNCCTL_KEY = vi.hoisted(() => {
  process.env.SYNCCTL_AUTH_KEY = "test-syncctl-key-0123456789";
  return process.env.SYNCCTL_AUTH_KEY;
});

import handler from "../../pages/api/admin/sync-quota-check";

// The sidecar of a sync pod asks this route before the pod starts. Its only credential is the SYNCCTL_AUTH_KEY bearer,
// compared in constant time (a compare with !== tells, by its time, how many leading characters of the key were right).
async function call(authorization: string | undefined) {
  // like a real response, it keeps the first thing sent: the route wrapper writes a default body after a handler that
  // already answered
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
      query: { workspaceId: "w1", syncId: "s1", package: "p", version: "1" },
      cookies: {},
      url: "/",
    } as any,
    res
  );
  return res;
}

describe("GET /api/admin/sync-quota-check authorization", () => {
  it("refuses a request without the key, with a wrong key of the same length, and with a shorter or longer one", async () => {
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
      const res = await call(authorization);
      expect(res.statusCode, String(authorization)).toBe(401);
      expect(res.body).toEqual({ ok: false, error: "Authorization Required" });
    }
  });

  it("lets the right key in", async () => {
    const res = await call(`Bearer ${SYNCCTL_KEY}`);
    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
  });
});
