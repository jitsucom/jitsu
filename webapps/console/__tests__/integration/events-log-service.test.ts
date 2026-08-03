import { describe, expect, it } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { EventsLogService } from "../../lib/server/events-log-service";

// Real ClickHouse via the harness: rows are inserted into the per-file
// events_log / dead_letter tables and assertions run against actual query
// RESULTS — workspace scoping, level/search/time filters, JSON parsing — not
// against SQL substrings.

const svc = () => new EventsLogService({ clickhouse: deps().clickhouse, prisma: deps().prisma });

const seedStream = (workspaceId: string, name: string) =>
  deps().prisma.configurationObject.create({ data: { workspaceId, type: "stream", config: { name } } });

const chInsert = (table: "events_log" | "dead_letter", values: any[]) =>
  deps().clickhouse.insert({ table, values, format: "JSONEachRow", clickhouse_settings: { wait_end_of_query: 1 } });

// Fixtures are anchored to NOW, never to calendar dates: the tables carry
// TTLs (dead_letter 1 month, events_log 3 months — see clickhouse-init.ts), so
// hardcoded timestamps quietly age out and every assertion starts seeing an
// empty result set. `ts(n)` / `iso(n)` are minute offsets from a base a couple
// of hours in the past — recent enough for any TTL, past enough that no row is
// dated in the future.
const BASE_MS = Date.now() - 2 * 60 * 60 * 1000;
const at = (minutes: number) => new Date(BASE_MS + minutes * 60_000);
/** ClickHouse DateTime64(3) literal, e.g. "2026-08-03 10:00:00.000". */
const ts = (minutes: number) => at(minutes).toISOString().replace("T", " ").replace("Z", "");
/** ISO string for the service's start/end filters. */
const iso = (minutes: number) => at(minutes).toISOString();

describe("EventsLogService", () => {
  it("rejects an unknown events-log type", async () => {
    const { user, workspace } = await seedWorkspace();
    await expect(svc().queryEventsLog(user, workspace.id, "bogus")).rejects.toThrow(/Unknown events-log type/);
  });

  it("rejects a source that doesn't belong to the workspace", async () => {
    const { user, workspace } = await seedWorkspace();
    const { workspace: foreign } = await seedWorkspace();
    const foreignStream = await seedStream(foreign.id, "foreign site");
    await expect(svc().queryEventsLog(user, workspace.id, "incoming", { source: foreignStream.id })).rejects.toThrow(
      /doesn't belong to the current workspace/
    );
  });

  it("incoming scopes to the workspace's streams; results come back newest first with parsed content", async () => {
    const { user, workspace } = await seedWorkspace();
    const stream = await seedStream(workspace.id, "site");
    const { workspace: foreign } = await seedWorkspace();
    const foreignStream = await seedStream(foreign.id, "other site");

    await chInsert("events_log", [
      {
        timestamp: ts(0),
        actorId: stream.id,
        type: "incoming",
        level: "info",
        message: JSON.stringify({ event: "page_view" }),
      },
      {
        timestamp: ts(60),
        actorId: stream.id,
        type: "incoming",
        level: "error",
        message: JSON.stringify({ event: "bad_event", reason: "invalid json" }),
      },
      // a different log type for the same actor must not appear
      {
        timestamp: ts(30),
        actorId: stream.id,
        type: "function",
        level: "info",
        message: "{}",
      },
      // another workspace's stream must not leak in
      {
        timestamp: ts(30),
        actorId: foreignStream.id,
        type: "incoming",
        level: "info",
        message: JSON.stringify({ event: "foreign" }),
      },
    ]);

    const rows = await svc().queryEventsLog(user, workspace.id, "incoming");
    expect(rows).toHaveLength(2);
    // newest first
    expect(rows[0].level).toBe("error");
    expect(rows[0].content).toEqual({ event: "bad_event", reason: "invalid json" });
    expect(rows[1].content).toEqual({ event: "page_view" });

    // levels filter narrows to errors
    const errors = await svc().queryEventsLog(user, workspace.id, "incoming", { levels: "error, warn" });
    expect(errors.map(r => r.level)).toEqual(["error"]);

    // a blank levels list adds no filter
    const blankLevels = await svc().queryEventsLog(user, workspace.id, "incoming", { levels: " , " });
    expect(blankLevels).toHaveLength(2);

    // search matches message content (ilike)
    const searched = await svc().queryEventsLog(user, workspace.id, "incoming", { search: "PAGE_VIEW" });
    expect(searched).toHaveLength(1);
    expect(searched[0].content).toEqual({ event: "page_view" });

    // time window: only the base row falls in [base, base+30m)
    const windowed = await svc().queryEventsLog(user, workspace.id, "incoming", {
      start: iso(0),
      end: iso(30),
    });
    expect(windowed).toHaveLength(1);
    expect(windowed[0].content).toEqual({ event: "page_view" });
  });

  it("function type scopes to connections + destinations + profile builders, not streams", async () => {
    const { user, workspace } = await seedWorkspace();
    const prisma = deps().prisma;
    const stream = await seedStream(workspace.id, "site");
    const dest = await prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "destination", config: { name: "wh", destinationType: "webhook" } },
    });
    const link = await prisma.configurationObjectLink.create({
      data: { workspaceId: workspace.id, fromId: stream.id, toId: dest.id },
    });
    const pb = await prisma.profileBuilder.create({
      data: { workspaceId: workspace.id, name: "pb", intermediateStorageCredentials: {} },
    });

    await chInsert("events_log", [
      { timestamp: ts(0), actorId: link.id, type: "function", level: "info", message: "{}" },
      { timestamp: ts(1), actorId: dest.id, type: "function", level: "info", message: "{}" },
      { timestamp: ts(2), actorId: pb.id, type: "function", level: "info", message: "{}" },
      // events attributed to the stream id must NOT show up for type=function
      { timestamp: ts(3), actorId: stream.id, type: "function", level: "info", message: "{}" },
    ]);

    const rows = await svc().queryEventsLog(user, workspace.id, "function");
    expect(rows).toHaveLength(3);

    // a stream id is not a valid specific source for function logs
    await expect(svc().queryEventsLog(user, workspace.id, "function", { source: stream.id })).rejects.toThrow(
      /doesn't belong to the current workspace/
    );
  });

  it("all-sources returns [] without querying when the workspace has no actors", async () => {
    const { user, workspace } = await seedWorkspace();
    await expect(svc().queryEventsLog(user, workspace.id, "function")).resolves.toEqual([]);
  });

  it("dead-letter is workspace-scoped and parses payload/error JSON", async () => {
    const { user, workspace } = await seedWorkspace();
    const { workspace: foreign } = await seedWorkspace();

    await chInsert("dead_letter", [
      {
        timestamp: ts(0),
        workspaceId: workspace.id,
        actorId: "conn-1",
        type: "function",
        payload: JSON.stringify({ a: 1 }),
        error: JSON.stringify({ e: "boom" }),
      },
      {
        timestamp: ts(1),
        workspaceId: workspace.id,
        actorId: "conn-1",
        type: "function",
        // httpPayload wrapper gets unwrapped
        payload: JSON.stringify({ httpPayload: { b: 2 } }),
        error: "not json",
      },
      {
        timestamp: ts(2),
        workspaceId: foreign.id,
        actorId: "conn-2",
        type: "function",
        payload: "{}",
        error: "{}",
      },
    ]);

    const rows = await svc().queryDeadLetter(user, workspace.id, {});
    expect(rows).toHaveLength(2); // the foreign workspace's row is absent
    expect(rows[0].payload).toEqual({ b: 2 }); // newest first + httpPayload unwrap
    expect(rows[0].error).toEqual({ error: "not json" }); // non-JSON error wrapped
    expect(rows[1].payload).toEqual({ a: 1 });
    expect(rows[1].error).toEqual({ e: "boom" });
  });

  it("dead-letter accepts a stream id as a specific source (any config object, not just destinations)", async () => {
    const { user, workspace } = await seedWorkspace();
    const stream = await seedStream(workspace.id, "site");
    await chInsert("dead_letter", [
      {
        timestamp: ts(0),
        workspaceId: workspace.id,
        actorId: stream.id,
        type: "incoming",
        payload: "{}",
        error: "{}",
      },
      {
        timestamp: ts(1),
        workspaceId: workspace.id,
        actorId: "other-actor",
        type: "incoming",
        payload: "{}",
        error: "{}",
      },
    ]);
    const rows = await svc().queryDeadLetter(user, workspace.id, { source: stream.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(stream.id);
  });

  it("listEventSources('incoming') returns streams", async () => {
    const { user, workspace } = await seedWorkspace();
    const stream = await seedStream(workspace.id, "My Site");
    const sources = await svc().listEventSources(user, workspace.id, "incoming");
    expect(sources).toEqual([{ id: stream.id, name: "My Site", kind: "stream" }]);
  });

  it("listEventSources('dead-letter') prepends the 'all' sentinel", async () => {
    const { user, workspace } = await seedWorkspace();
    const sources = await svc().listEventSources(user, workspace.id, "dead-letter");
    expect(sources[0]).toEqual({ id: "all", name: "All sources", kind: "all" });
  });
});
