import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { deps, seedWorkspace } from "./support/harness";
import { getExport } from "../../pages/api/admin/export/[name]";
import { BulkerConnectionRow, RotorConnectionRow, RotorDestinationRow } from "../../lib/schema/export-contracts";

// Integration coverage for the admin config exports (JITSU-181, postmortem
// JITSU-158 items 4+5): the exports run against a real per-file Postgres
// seeded with the incident shapes, and every emitted row is checked against
// the consumer contract the route itself enforces at the write site.
//
// The tests call the Export directly (getExport(name).data(writer)) — the
// route's auth/streaming shell is thin and the postmortem class of bug lives
// entirely in the data function.

async function runExport(name: string): Promise<any[]> {
  const chunks: string[] = [];
  await getExport(name).data({ write: s => void chunks.push(s) });
  return JSON.parse(chunks.join(""));
}

async function seedClickhouseDest(workspaceId: string, name: string) {
  return deps().prisma.configurationObject.create({
    data: {
      workspaceId,
      type: "destination",
      config: { name, destinationType: "clickhouse", hosts: ["ch.test.local:8443"], username: "u", password: "p" },
    },
  });
}

describe("admin config exports (JITSU-181)", () => {
  it("bulker-connections: incident shapes materialize defaults, round-trip stored options, and skip corrupt rows", async () => {
    const { workspace } = await seedWorkspace();
    const prisma = deps().prisma;
    const stream = await prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "stream", config: { name: "site" } },
    });
    const link = async (destName: string, data: Prisma.InputJsonValue | typeof Prisma.JsonNull) => {
      const dest = await seedClickhouseDest(workspace.id, destName);
      return prisma.configurationObjectLink.create({
        data: { workspaceId: workspace.id, fromId: stream.id, toId: dest.id, data },
      });
    };

    // the incident shapes (postmortem item 4)
    const lNull = await link("d-null", Prisma.JsonNull); // null-`data` connection (079fd5da9)
    const lEmpty = await link("d-empty", {}); // blank options
    const lWrong = await link("d-wrong", { deduplicate: "definitely", mode: 123, keepMe: "kept" }); // wrong-typed -> tolerant fallback
    const lFull = await link("d-full", { mode: "stream", batchSize: 500, customExtra: "x" }); // round-trip
    const lCorrupt = await link("d-corrupt", "not-an-object" as unknown as Prisma.InputJsonValue); // unparseable root

    const all = await runExport("bulker-connections");
    const rows = all.filter(r => r.workspaceId === workspace.id);
    const byId = new Map(rows.map(r => [r.id, r]));

    // every emitted row conforms to the consumer contract
    for (const row of rows) {
      expect(() => BulkerConnectionRow.parse(row), `contract violation in ${row.id}`).not.toThrow();
    }
    // ...which implies the JITSU-158 regression shape (blank options on link
    // rows) can never ship: assert it directly too
    for (const row of rows) {
      expect(Object.keys(row.options).length, `empty options shipped for ${row.id}`).toBeGreaterThan(0);
    }

    // null-data and empty-data links materialize the destination-type defaults
    for (const l of [lNull, lEmpty]) {
      const row = byId.get(l.id);
      expect(row, `link ${l.id} missing from export`).toBeDefined();
      expect(row.options).toMatchObject({
        mode: "batch",
        deduplicate: true,
        primaryKey: "timestamp,message_id", // clickhouse overrides the base default
        dataLayout: "segment-single-table",
      });
      // back-compat: frequency must stay absent unless actually stored
      expect(row.options.frequency).toBeUndefined();
    }

    // round-trip: what was stored comes back, plus materialized defaults
    const full = byId.get(lFull.id);
    expect(full.options).toMatchObject({ mode: "stream", batchSize: 500, customExtra: "x", deduplicate: true });

    // wrong-typed fields take the tolerant fallback: stored fields ship as-is
    const wrong = byId.get(lWrong.id);
    expect(wrong.options).toMatchObject({ deduplicate: "definitely", mode: 123, keepMe: "kept" });

    // unparseable root -> generic fallback yields {} -> output contract skips
    // the row instead of shipping it malformed (postmortem item 5)
    expect(byId.has(lCorrupt.id)).toBe(false);

    // standalone destination rows are exported too, with hardcoded options
    const destRow = rows.find(r => r.id === lFull.toId);
    expect(destRow).toBeDefined();
    expect(destRow.options).toEqual({ mode: "batch", frequency: 1, deduplicate: true });
    // clickhouse credential special-casing (link rows only) survives the
    // contract parse
    expect(full.credentials.loadAsJson).toBe(false);
  });

  it("rotor-connections: link rows carry options+optionsHash, destination rows carry neither, all conform", async () => {
    const { workspace } = await seedWorkspace();
    const prisma = deps().prisma;
    const stream = await prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "stream", config: { name: "site" } },
    });
    const webhookDest = await prisma.configurationObject.create({
      data: {
        workspaceId: workspace.id,
        type: "destination",
        config: { name: "hook", destinationType: "webhook", url: "https://hook.test.local" },
      },
    });
    const chDest = await seedClickhouseDest(workspace.id, "wh");
    const webhookLink = await prisma.configurationObjectLink.create({
      data: { workspaceId: workspace.id, fromId: stream.id, toId: webhookDest.id, data: {} },
    });
    const chLink = await prisma.configurationObjectLink.create({
      data: {
        workspaceId: workspace.id,
        fromId: stream.id,
        toId: chDest.id,
        data: { mode: "stream", batchSize: 500, customExtra: "x" },
      },
    });

    const all = await runExport("rotor-connections");
    const rows = all.filter(r => r.workspaceId === workspace.id);
    const byId = new Map(rows.map(r => [r.id, r]));

    const wRow = byId.get(webhookLink.id);
    const chRow = byId.get(chLink.id);
    expect(wRow).toBeDefined();
    expect(chRow).toBeDefined();
    for (const row of [wRow, chRow]) {
      expect(() => RotorConnectionRow.parse(row)).not.toThrow();
    }
    expect(wRow).toMatchObject({
      streamId: stream.id,
      streamName: "site",
      destinationId: webhookDest.id,
      usesBulker: false,
    });
    expect(chRow.usesBulker).toBe(true);
    // round-trip of stored options
    expect(chRow.options).toMatchObject({ mode: "stream", batchSize: 500, customExtra: "x" });
    expect(chRow.optionsHash).not.toBe(wRow.optionsHash); // hash reflects stored data

    // standalone destination rows: no options/optionsHash by design
    const chDestRow = rows.find(r => r.id === chDest.id);
    expect(chDestRow).toBeDefined();
    expect("options" in chDestRow).toBe(false);
    expect("optionsHash" in chDestRow).toBe(false);
    expect(() => RotorDestinationRow.parse(chDestRow)).not.toThrow();
    // webhook is hybrid, so it gets a standalone destination row too — and it
    // must conform like any other
    const webhookDestRow = rows.find(r => r.id === webhookDest.id && !("options" in r));
    expect(webhookDestRow).toBeDefined();
    expect(() => RotorDestinationRow.parse(webhookDestRow)).not.toThrow();
  });

  it("output contracts reject the JITSU-158 regression shape", () => {
    // a {data_}-typo-class regression blanks options on every row; the contract
    // must refuse such a row so it is skipped-and-logged, never shipped
    const base = {
      id: "l1",
      workspaceId: "w1",
      type: "clickhouse",
      updatedAt: new Date(),
      credentials: { host: "x" },
    };
    expect(BulkerConnectionRow.safeParse({ ...base, options: {} }).success).toBe(false);
    expect(BulkerConnectionRow.safeParse({ ...base, options: { mode: "batch" } }).success).toBe(true);

    const rotorBase = {
      ...base,
      streamId: "s1",
      destinationId: "d1",
      usesBulker: true,
      credentialsHash: "h",
      optionsHash: "h",
    };
    expect(RotorConnectionRow.safeParse({ ...rotorBase, options: {} }).success).toBe(false);
    expect(RotorConnectionRow.safeParse({ ...rotorBase, options: { mode: "batch" } }).success).toBe(true);
    expect(RotorConnectionRow.safeParse({ ...rotorBase, options: { mode: "batch" }, optionsHash: "" }).success).toBe(
      false
    );
  });
});
