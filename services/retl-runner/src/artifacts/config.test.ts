import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";

// Records which bucket and prefix each store is built for, instead of creating cloud clients.
const { gcsObjects, s3Objects } = vi.hoisted(() => ({
  gcsObjects: vi.fn((bucket: string, prefix: string) => ({ kind: "gcs", bucket, prefix })),
  s3Objects: vi.fn((bucket: string, prefix: string) => ({ kind: "s3", bucket, prefix })),
}));
vi.mock("./cloud", () => ({ gcsObjects, s3Objects }));

import { runObjectStorage } from "./config";

const signal = new AbortController().signal;
const env = { RETL_OBJECT_STORE: "gcs", RETL_OBJECT_BUCKET: "shared-bucket", RETL_OBJECT_PREFIX: "reverse-etl/" };

beforeEach(() => {
  gcsObjects.mockClear();
  s3Objects.mockClear();
});

describe("object storage for a run (JITSU-242 retention wiring)", () => {
  it("without a retention bucket in the run configuration there is no retention store: everything stays as before", () => {
    const storage = runObjectStorage(env, signal, {});
    expect(storage).toEqual({ signal, store: { kind: "gcs", bucket: "shared-bucket", prefix: "reverse-etl/" } });
    expect("retention" in storage).toBe(false);
    expect(gcsObjects).toHaveBeenCalledTimes(1);
  });

  it("the run configuration's retention bucket, not the environment bucket, backs the retention store", () => {
    const storage = runObjectStorage(env, signal, { retention: { bucket: "jitsu-retl-ws1" } });
    expect(storage.store).toEqual({ kind: "gcs", bucket: "shared-bucket", prefix: "reverse-etl/" });
    expect(storage.retention).toEqual({ kind: "gcs", bucket: "jitsu-retl-ws1", prefix: "reverse-etl/" });
  });

  it("the retention store uses the same provider and prefix as the main store (s3)", () => {
    const storage = runObjectStorage(
      { RETL_OBJECT_STORE: "s3", RETL_OBJECT_BUCKET: "shared-bucket", RETL_OBJECT_PREFIX: "custom" },
      signal,
      { retention: { bucket: "jitsu-retl-ws1" } }
    );
    expect(storage.store).toEqual({ kind: "s3", bucket: "shared-bucket", prefix: "custom/" });
    expect(storage.retention).toEqual({ kind: "s3", bucket: "jitsu-retl-ws1", prefix: "custom/" });
  });

  it("works from a parsed run configuration, as main.ts uses it", () => {
    const parsed = ReverseRunConfig.parse({
      version: 1,
      kind: "reverse",
      id: "retl-sync",
      workspaceId: "ws1",
      fromId: "model",
      toId: "destination",
      configRevision: "a".repeat(64),
      updatedAt: "2026-10-05T12:00:00.000Z",
      model: { warehouseId: "w", query: "SELECT 1 AS id", primaryKey: ["id"] },
      warehouse: { destinationType: "postgres" },
      destination: { destinationType: "webhook" },
      options: {
        version: 2,
        stream: "rows",
        mode: "upsert",
        mapping: { id: "id" },
        streamOptions: { deliveryAttested: true },
        schedule: "",
        timezone: "Etc/UTC",
      },
      retention: { bucket: "jitsu-retl-ws1" },
    });
    expect(runObjectStorage(env, signal, parsed).retention).toEqual({
      kind: "gcs",
      bucket: "jitsu-retl-ws1",
      prefix: "reverse-etl/",
    });
  });

  it("a retention bucket without a configured object store is refused instead of silently using the shared bucket", () => {
    expect(() =>
      runObjectStorage({ RETL_OBJECT_BUCKET: "shared-bucket" }, signal, { retention: { bucket: "jitsu-retl-ws1" } })
    ).toThrow("RETL_OBJECT_STORE is required");
  });

  it("the main store still requires its own bucket", () => {
    expect(() =>
      runObjectStorage({ RETL_OBJECT_STORE: "gcs" }, signal, { retention: { bucket: "jitsu-retl-ws1" } })
    ).toThrow("RETL_OBJECT_BUCKET is required");
  });
});
