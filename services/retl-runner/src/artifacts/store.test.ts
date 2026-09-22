import { describe, it, expect } from "vitest";
import { Artifacts } from "./store";
import { MemoryObjects } from "./test-support";
import { LocalIndex } from "./local";
import { effects } from "../persistence/effects";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";

const scope = {
  workspaceId: "w",
  syncId: "s",
  taskId: "t",
  logicalRunId: "r",
  configRevision: "v",
  targetIdentity: "target",
  mode: "mirror" as const,
  extraction: "full" as const,
};
describe("immutable artifacts", () => {
  it("round trips lossless JSON and reuses identical artifacts", async () => {
    const objects = new MemoryObjects(),
      a = new Artifacts(objects, scope, new AbortController().signal);
    const value = { nul: "\0", surrogate: "\ud800", bigint: "9007199254740993" };
    const ref = await a.put(value);
    expect(await a.put(value)).toEqual(ref);
    expect(objects.objects.size).toBe(1);
    expect(await a.get(ref)).toEqual(value);
    await expect(
      new Artifacts(objects, { ...scope, syncId: "other" }, new AbortController().signal).get(ref)
    ).rejects.toThrow("scope mismatch");
  });
  it("fails closed on missing, corrupt and oversized files without leaking payloads", async () => {
    const objects = new MemoryObjects(),
      a = new Artifacts(objects, scope, new AbortController().signal);
    const ref = await a.put({ email: "private@example.test" });
    objects.objects.set(ref.key, Buffer.from("private@example.test"));
    await expect(a.get(ref)).rejects.toThrow("missing or corrupt");
    objects.objects.delete(ref.key);
    await expect(a.get(ref)).rejects.toThrow("missing or corrupt");
    await expect(a.put("x".repeat(16_000_000))).rejects.toThrow("byte limit");
  });
  it("honors cancellation before reads and writes", async () => {
    const signal = AbortSignal.abort();
    await expect(new Artifacts(new MemoryObjects(), scope, signal).put({})).rejects.toThrow();
  });
});
describe("local snapshot indexing", () => {
  const effect = (id: string) => effects([{ identity: id, upsert: { id }, remove: { id } }])[0];
  it("counts new, changed, expired, unchanged and removed identities separately", async () => {
    const local = await LocalIndex.create();
    try {
      local.restoreMembers(
        ["changed", "refresh", "unchanged", "removed"].map(id => ({
          effect: effect(id),
          acceptedAt: id === "unchanged" ? "2026-09-19T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
        }))
      );
      const changed = effects([
        { identity: "changed", upsert: { id: "changed", name: "new" }, remove: { id: "changed" } },
      ])[0];
      local.append(
        ["new", "refresh", "unchanged"]
          .map(id => ({ key: contentHash(id), effects: [effect(id)] }))
          .concat([{ key: contentHash("changed"), effects: [changed] }])
      );
      expect(local.comparison("2026-08-20T00:00:00.000Z")).toEqual({
        baselineMembers: 4,
        uniqueMembers: 4,
        newMembers: 1,
        changedMembers: 1,
        refreshMembers: 1,
        unchangedMembers: 1,
        removals: 1,
      });
      expect(local.comparison(null)).toMatchObject({ refreshMembers: 0, unchangedMembers: 2 });
    } finally {
      await local.close();
    }
  });
  // Exercise the real 15 MB page boundary with SQLite and compression; allow for shared CI disk/CPU contention.
  it("splits snapshot and baseline artifacts by serialized bytes, not only row count", async () => {
    const local = await LocalIndex.create();
    try {
      const values = Array.from(
        { length: 1000 },
        (_, i) =>
          effects([
            { identity: String(i), upsert: { id: String(i), payload: "x".repeat(20000) }, remove: { id: String(i) } },
          ])[0]
      );
      local.append(values.map((value, i) => ({ key: contentHash(i), effects: [value] })));
      local.restoreMembers(values.map(effect => ({ effect, acceptedAt: "2026-01-01T00:00:00.000Z" })));
      const artifacts = new Artifacts(new MemoryObjects(), scope, new AbortController().signal);
      for (const pages of [local.desiredPages(), local.memberPages()]) {
        let count = 0,
          pageCount = 0;
        for (const page of pages) {
          await artifacts.put(page);
          count += page.length;
          pageCount++;
        }
        expect(count).toBe(1000);
        expect(pageCount).toBeGreaterThan(1);
      }
    } finally {
      await local.close();
    }
  }, 30000);
  it("deduplicates shared identities, rejects duplicate source keys and conflicting payloads atomically", async () => {
    const local = await LocalIndex.create();
    try {
      local.append([
        { key: contentHash(1), effects: [effect("a")] },
        { key: contentHash(2), effects: [effect("a")] },
      ]);
      expect([...local.desiredPages()].flat()).toHaveLength(1);
      expect(() =>
        local.append([
          { key: contentHash(3), effects: [effect("b")] },
          { key: contentHash(1), effects: [effect("c")] },
        ])
      ).toThrow("Duplicate");
      expect([...local.desiredPages()].flat()).toHaveLength(1);
      expect(() =>
        local.append([{ key: contentHash(3), effects: [{ ...effect("a"), remove: { id: "changed" } }] }])
      ).toThrow("Conflicting");
    } finally {
      await local.close();
    }
  });
  it("uses local joins for additions, changes, refreshes and removals; tombstones reject late acceptance", async () => {
    const local = await LocalIndex.create();
    try {
      local.append([{ key: contentHash(1), effects: [effect("a"), effect("b")] }]);
      local.restoreMembers([
        { effect: effect("a"), acceptedAt: "2026-01-01T00:00:00.000Z" },
        { effect: effect("c"), acceptedAt: "2026-01-01T00:00:00.000Z" },
      ]);
      expect(local.page("additions", "", 100, null)).toEqual([effect("b")]);
      expect(local.page("additions", "", 100, "2026-02-01T00:00:00.000Z")).toHaveLength(2);
      expect(local.page("removals", "", 100, null)).toEqual([effect("c")]);
      local.apply(effect("a"), "remove", 2, "2026-03-01T00:00:00.000Z");
      local.apply(effect("a"), "upsert", 1, "2026-04-01T00:00:00.000Z");
      expect([...local.memberPages()].flat().map(row => row.effect.identity)).toEqual(["c"]);
    } finally {
      await local.close();
    }
  });
});
