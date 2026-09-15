import { describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "../../pages/api/version";

describe("public version endpoint", () => {
  it("never returns environment diagnostics, even with the legacy flag enabled", async () => {
    vi.stubEnv("__DANGEROUS_ENABLE_FULL_DIAGNOSTICS", "true");
    vi.stubEnv("JITSU190_SECRET", "must-not-appear-in-response");
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "false");
    const req = {
      method: "GET",
      url: "/api/version",
      headers: {},
      cookies: {},
      query: {},
      socket: {},
    } as NextApiRequest;
    let body: unknown;
    const res = {
      statusCode: 200,
      setHeader() {
        return this;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(value: unknown) {
        body = value;
        return this;
      },
      send(value: unknown) {
        body = value;
        return this;
      },
    };
    await handler(req, res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ version: expect.any(String), node: { version: process.version } });
    expect(body).not.toHaveProperty("diagnostics");
    expect(JSON.stringify(body)).not.toContain("must-not-appear-in-response");
  });
});
