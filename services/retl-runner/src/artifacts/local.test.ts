import { describe, it, expect } from "vitest";
import { LocalIndex } from "./local";
import { effects } from "../persistence/effects";

const effect = (id: string) => effects([{ identity: id, upsert: { id }, remove: { id } }])[0];
const members = (ids: string[]) => ids.map(id => ({ effect: effect(id), acceptedAt: "2026-01-01T00:00:00.000Z" }));
const count = (local: LocalIndex) => (local.sql.prepare("SELECT count(*) AS n FROM members").get() as { n: number }).n;

describe("local index", () => {
  // The index is a scratch file rebuilt from the object store every time a run starts, so a crash loses nothing. On a
  // runner pod's disk each synchronous commit of a restored batch cost about 110 ms (500 batches: 55 s of an 84 s start).
  it("does not wait for the disk on every commit", async () => {
    const local = await LocalIndex.create();
    try {
      expect(local.sql.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 0 });
    } finally {
      await local.close();
    }
  });

  it("joins a nested transaction to the outer one and commits once", async () => {
    const local = await LocalIndex.create();
    try {
      local.transaction(() => {
        local.restoreMembers(members(["a", "b"])); // its own transaction inside the caller's
        local.restoreMembers(members(["c"]));
        local.apply(effect("d"), "upsert", 1, "2026-01-01T00:00:00.000Z");
      });
      expect(count(local)).toBe(4);
    } finally {
      await local.close();
    }
  });

  it("rolls everything back when a nested step fails, and works again afterwards", async () => {
    const local = await LocalIndex.create();
    try {
      expect(() =>
        local.transaction(() => {
          local.restoreMembers(members(["a", "b"]));
          local.transaction(() => {
            throw new Error("boom");
          });
        })
      ).toThrow("boom");
      expect(count(local)).toBe(0);
      local.restoreMembers(members(["x"])); // a failed transaction must not leave the index stuck inside one
      expect(count(local)).toBe(1);
    } finally {
      await local.close();
    }
  });

  describe("mergeRemove", () => {
    const withRemove = (id: string, upsert: string, remove: string) =>
      effects([{ identity: id, upsert: { v: upsert }, remove: { v: remove } }])[0];
    const joined = (previous: Record<string, unknown>, next: Record<string, unknown>) => ({
      v: `${next.v}+${previous.v}`,
    });
    const kept = (local: LocalIndex, e: ReturnType<typeof effect>) =>
      JSON.parse(
        String((local.sql.prepare("SELECT value FROM members WHERE identity=?").get(e.identityHash) as any).value)
      );
    const at = "2026-01-01T00:00:00.000Z";

    it("keeps what an earlier accepted Add sent, merged into the removal of the newer one", async () => {
      const local = await LocalIndex.create(joined as never);
      try {
        const first = withRemove("p", "a", "a");
        const second = withRemove("p", "b", "b");
        local.apply(first, "upsert", 1, at);
        local.apply(second, "upsert", 2, at);
        expect(kept(local, second)).toMatchObject({ upsert: { v: "b" }, remove: { v: "b+a" } });
      } finally {
        await local.close();
      }
    });

    it("still remembers an older Add that is applied after a newer one, without replacing the newer", async () => {
      const local = await LocalIndex.create(joined as never);
      try {
        local.apply(withRemove("p", "b", "b"), "upsert", 2, at);
        local.apply(withRemove("p", "a", "a"), "upsert", 1, at);
        expect(kept(local, withRemove("p", "b", "b"))).toMatchObject({ upsert: { v: "b" }, remove: { v: "a+b" } });
      } finally {
        await local.close();
      }
    });

    it("forgets everything once the member is removed, and starts again from the next Add", async () => {
      const local = await LocalIndex.create(joined as never);
      try {
        const first = withRemove("p", "a", "a");
        local.apply(first, "upsert", 1, at);
        local.apply(first, "remove", 2, at);
        local.apply(withRemove("p", "c", "c"), "upsert", 3, at);
        expect(kept(local, first)).toMatchObject({ remove: { v: "c" } });
      } finally {
        await local.close();
      }
    });

    it("changes nothing without a merge function", async () => {
      const local = await LocalIndex.create();
      try {
        local.apply(withRemove("p", "a", "a"), "upsert", 1, at);
        local.apply(withRemove("p", "b", "b"), "upsert", 2, at);
        expect(kept(local, withRemove("p", "b", "b"))).toMatchObject({ remove: { v: "b" } });
      } finally {
        await local.close();
      }
    });
  });
});
