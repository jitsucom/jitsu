import { Prisma, type PrismaClient } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { exportReverseSyncs } from "../../lib/server/reverse-sync-export";

function expiredTransaction() {
  return new Prisma.PrismaClientKnownRequestError("A commit cannot be executed on an expired transaction.", {
    clientVersion: Prisma.prismaVersion.client,
    code: "P2028",
  });
}

function exportWith(transact: ReturnType<typeof vi.fn>) {
  const db = {
    configurationObjectLink: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([{ id: "sync1" }])
        .mockResolvedValue([]),
    },
    $transaction: transact,
  };
  const chunks: string[] = [];
  const result = exportReverseSyncs(db as unknown as PrismaClient, { write: chunk => chunks.push(chunk) });
  return { result, chunks };
}

it("writes a sync once when the initial snapshot expires at commit", async () => {
  const snapshot = {
    version: 1,
    kind: "reverse",
    id: "sync1",
    workspaceId: "ws",
    fromId: "model",
    toId: "destination",
    configRevision: "a".repeat(64),
    updatedAt: new Date().toISOString(),
    model: { warehouseId: "wh", query: "SELECT id FROM users", primaryKey: ["id"] },
    warehouse: {},
    destination: {},
    options: { version: 2, stream: "audience", mode: "upsert", mapping: {} },
  };
  const transact = vi.fn().mockRejectedValueOnce(expiredTransaction()).mockResolvedValue(snapshot);
  const { result, chunks } = exportWith(transact);
  await result;
  expect(JSON.parse(chunks.join("")).map((row: { id: string }) => row.id)).toEqual(["sync1"]);
  expect(transact).toHaveBeenCalledTimes(2);
});

it.each([
  [expiredTransaction(), 2],
  [new Error("configuration is invalid"), 1],
] as const)("aborts the stream after bounded or permanent failure", async (error, attempts) => {
  const transact = vi.fn().mockRejectedValue(error);
  const { result, chunks } = exportWith(transact);
  await expect(result).rejects.toBe(error);
  expect(transact).toHaveBeenCalledTimes(attempts);
  expect(chunks.join("")).toBe("[");
});
