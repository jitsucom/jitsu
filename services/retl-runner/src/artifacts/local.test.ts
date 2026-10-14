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
});
