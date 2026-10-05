import { describe, expect, it } from "vitest";
import { ReverseRunConfig } from "./runtime";

const base = {
  version: 1,
  kind: "reverse",
  id: "sync",
  workspaceId: "workspace",
  fromId: "model",
  toId: "destination",
  configRevision: "a".repeat(64),
  updatedAt: "2026-10-05T10:00:00.000Z",
  model: { warehouseId: "warehouse", query: "SELECT id FROM users", primaryKey: ["id"] },
  warehouse: { destinationType: "postgres" },
  destination: { destinationType: "test" },
  options: { stream: "audience", mode: "upsert", mapping: { id: "id" } },
};

describe("run configuration retention field", () => {
  it("is optional: a configuration without it parses and has no retention", () => {
    expect(ReverseRunConfig.parse(base).retention).toBeUndefined();
  });
  it("accepts a retention bucket with the jitsu-retl- prefix", () => {
    const parsed = ReverseRunConfig.parse({ ...base, retention: { bucket: "jitsu-retl-cl9sotck40002tt2b18i2x430" } });
    expect(parsed.retention).toEqual({ bucket: "jitsu-retl-cl9sotck40002tt2b18i2x430" });
  });
  it("refuses any other bucket, so a bug elsewhere cannot point the runner at an unrelated bucket", () => {
    for (const bucket of [
      "jitsu-backup-abc",
      "jitsu-cloud-infra-reverse-etl",
      "retl-abc",
      "jitsu-retl-",
      "jitsu-retl-UPPER",
      "jitsu-retl-a/b",
    ]) {
      expect(() => ReverseRunConfig.parse({ ...base, retention: { bucket } }), bucket).toThrow();
    }
  });
  it("refuses unknown keys inside retention and a bucket name over 63 characters", () => {
    expect(() => ReverseRunConfig.parse({ ...base, retention: { bucket: "jitsu-retl-abc", extra: 1 } })).toThrow();
    expect(() => ReverseRunConfig.parse({ ...base, retention: { bucket: "jitsu-retl-" + "a".repeat(53) } })).toThrow();
    expect(
      ReverseRunConfig.parse({ ...base, retention: { bucket: "jitsu-retl-" + "a".repeat(52) } }).retention
    ).toBeTruthy();
  });
});
