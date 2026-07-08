import { describe, expect, it } from "vitest";
import {
  deps,
  seedWorkspace,
  seedConfigObject,
  seedLink,
  seedProfileBuilder,
  insertEventsLog,
  insertDeadLetter,
} from "./support/harness";
import { EventsLogService } from "../../lib/server/events-log-service";

// Real ClickHouse via the harness: rows are inserted into the per-file
// events_log / dead_letter tables and assertions run against actual query
// RESULTS — workspace scoping, level/search/time filters, JSON parsing — not
// against SQL substrings.

const svc = () => new EventsLogService({ clickhouse: deps().clickhouse, prisma: deps().prisma });

describe("EventsLogService", () => {
  it("rejects an unknown events-log type", async () => {
    const { user, workspace } = await seedWorkspace();
    await expect(svc().queryEventsLog(user, workspace.id, "bogus")).rejects.toThrow(/Unknown events-log type/);
  });

  it("rejects a source that doesn't belong to the workspace", async () => {
    const { user, workspace } = await seedWorkspace();
    const { workspace: foreign } = await seedWorkspace();
    const foreignStream = await seedConfigObject(foreign.id, "stream", { name: "foreign site" });
    await expect(svc().queryEventsLog(user, workspace.id, "incoming", { source: foreignStream.id })).rejects.toThrow(
      /doesn't belong to the current workspace/
    );
  });

  it("incoming scopes to the workspace's streams; results come back newest first with parsed content", async () => {
    const { user, workspace } = await seedWorkspace();
    const stream = await seedConfigObject(workspace.id, "stream", { name: "site" });
    const { workspace: foreign } = await seedWorkspace();
    const foreignStream = await seedConfigObject(foreign.id, "stream", { name: "other site" });

    await insertEventsLog([
      {
        timestamp: "2026-07-01 10:00:00.000",
        actorId: stream.id,
        type: "incoming",
        level: "info",
        message: JSON.stringify({ event: "page_view" }),
      },
      {
        timestamp: "2026-07-01 11:00:00.000",
        actorId: stream.id,
        type: "incoming",
        level: "error",
        message: JSON.stringify({ event: "bad_event", reason: "invalid json" }),
      },
      // a different log type for the same actor must not appear
      {
        timestamp: "2026-07-01 10:30:00.000",
        actorId: stream.id,
        type: "function",
        level: "info",
        message: "{}",
      },
      // another workspace's stream must not leak in
      {
        timestamp: "2026-07-01 10:30:00.000",
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

    // time window: only the 10:00 row falls in [10:00, 10:30)
    const windowed = await svc().queryEventsLog(user, workspace.id, "incoming", {
      start: "2026-07-01T10:00:00.000Z",
      end: "2026-07-01T10:30:00.000Z",
    });
    expect(windowed).toHaveLength(1);
    expect(windowed[0].content).toEqual({ event: "page_view" });
  });

  it("function type scopes to connections + destinations + profile builders, not streams", async () => {
    const { user, workspace } = await seedWorkspace();
    const stream = await seedConfigObject(workspace.id, "stream", { name: "site" });
    const dest = await seedConfigObject(workspace.id, "destination", { name: "wh", destinationType: "webhook" });
    const link = await seedLink(workspace.id, stream.id, dest.id);
    const pb = await seedProfileBuilder(workspace.id);

    await insertEventsLog([
      { timestamp: "2026-07-01 10:00:00.000", actorId: link.id, type: "function", level: "info", message: "{}" },
      { timestamp: "2026-07-01 10:01:00.000", actorId: dest.id, type: "function", level: "info", message: "{}" },
      { timestamp: "2026-07-01 10:02:00.000", actorId: pb.id, type: "function", level: "info", message: "{}" },
      // events attributed to the stream id must NOT show up for type=function
      { timestamp: "2026-07-01 10:03:00.000", actorId: stream.id, type: "function", level: "info", message: "{}" },
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

    await insertDeadLetter([
      {
        timestamp: "2026-07-01 10:00:00.000",
        workspaceId: workspace.id,
        actorId: "conn-1",
        type: "function",
        payload: JSON.stringify({ a: 1 }),
        error: JSON.stringify({ e: "boom" }),
      },
      {
        timestamp: "2026-07-01 10:01:00.000",
        workspaceId: workspace.id,
        actorId: "conn-1",
        type: "function",
        // httpPayload wrapper gets unwrapped
        payload: JSON.stringify({ httpPayload: { b: 2 } }),
        error: "not json",
      },
      {
        timestamp: "2026-07-01 10:02:00.000",
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
    const stream = await seedConfigObject(workspace.id, "stream", { name: "site" });
    await insertDeadLetter([
      {
        timestamp: "2026-07-01 10:00:00.000",
        workspaceId: workspace.id,
        actorId: stream.id,
        type: "incoming",
        payload: "{}",
        error: "{}",
      },
      {
        timestamp: "2026-07-01 10:01:00.000",
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
    const stream = await seedConfigObject(workspace.id, "stream", { name: "My Site" });
    const sources = await svc().listEventSources(user, workspace.id, "incoming");
    expect(sources).toEqual([{ id: stream.id, name: "My Site", kind: "stream" }]);
  });

  it("listEventSources('dead-letter') prepends the 'all' sentinel", async () => {
    const { user, workspace } = await seedWorkspace();
    const sources = await svc().listEventSources(user, workspace.id, "dead-letter");
    expect(sources[0]).toEqual({ id: "all", name: "All sources", kind: "all" });
  });
});
