import { describe, it, expect, vi } from "vitest";
import type { WarehouseReader } from "@jitsu/warehouse-query";
import type { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import {
  createGoogleDataManager,
  projectGoogleAudience,
} from "@jitsu/destination-functions/src/functions/google-ads/audience/runtime";
import { prepareSource } from "./source-preflight";
import { defaultLimits } from "./persistence/types";

describe("source preflight", () => {
  const google = createGoogleDataManager(async () => "unused");
  const validation = {
    stream: google.mirrorStream,
    projection: { rowType: google.stream.rowType, project: (row: any) => projectGoogleAudience("upsert", row) },
  };
  const config = {
    model: { primaryKey: ["id"] },
    options: { mode: "mirror", mapping: { email: "email" } },
  } as unknown as ReverseRunConfig;
  function source() {
    const stream = vi.fn(async function* () {
      yield { row: { id: "1", email: "One@example.com", ignored: "not staged" }, deleted: false };
      yield { row: { id: "2", email: "Two@example.com" }, deleted: false };
    });
    const close = vi.fn(async () => {});
    return { stream, close } as unknown as WarehouseReader;
  }
  it("reuses the exact validated rows without querying again, drops unmapped data and closes the reader", async () => {
    const reader = source();
    const signal = new AbortController().signal;
    const staged = await prepareSource(config, validation, reader, signal, defaultLimits);
    try {
      expect(staged.count).toBe(2);
      const rows: Record<string, unknown>[] = [];
      for await (const row of staged.rows(signal)) rows.push(row.row);
      expect(rows).toEqual([
        { id: "1", email: "One@example.com" },
        { id: "2", email: "Two@example.com" },
      ]);
      expect(reader.stream).toHaveBeenCalledTimes(1);
      expect(reader.close).toHaveBeenCalledTimes(1);
    } finally {
      await staged.close();
    }
  });
  it("rejects snapshot budget overflow before provisioning", async () => {
    const reader = source();
    await expect(
      prepareSource(config, validation, reader, new AbortController().signal, { ...defaultLimits, snapshotEntries: 1 })
    ).rejects.toThrow("No audience changes were submitted");
    expect(reader.close).toHaveBeenCalledTimes(1);
  });
});
