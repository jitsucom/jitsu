import type { NextApiRequest, NextApiResponse } from "next";
import { expect, it, vi } from "vitest";
import healthcheck from "../../pages/api/healthcheck";
import { db } from "../../lib/server/db";

it("responds to liveness during database failure while readiness reports unavailable", async () => {
  const prisma = vi.spyOn(db.prisma, "waitInit").mockRejectedValue(new Error("database unavailable"));
  const pg = vi.spyOn(db.pgPool, "waitInit").mockRejectedValue(new Error("database unavailable"));
  try {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn() };
    const probe = (query: NextApiRequest["query"]) =>
      healthcheck({ query } as NextApiRequest, res as unknown as NextApiResponse);
    await probe({ probe: "live" });
    expect(res.status).toHaveBeenLastCalledWith(200);
    expect(prisma).not.toHaveBeenCalled();
    expect(pg).not.toHaveBeenCalled();
    await probe({});
    expect(res.status).toHaveBeenLastCalledWith(503);
  } finally {
    vi.restoreAllMocks();
  }
});
