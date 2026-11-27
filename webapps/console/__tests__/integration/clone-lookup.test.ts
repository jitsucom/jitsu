import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./support/msw";
import { deps, seedWorkspace } from "./support/harness";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { DebugService } from "../../lib/server/debug-service";
import { SyncService } from "../../lib/server/sync-service";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import type { WarehouseReader } from "@jitsu/warehouse-query";
import { redshiftSql } from "@jitsu/warehouse-query/src/redshift";

// JITSU-281: a masked value is restored from the object named by `cloneId`. That lookup found any object of the workspace
// by id, with no filter on its type and none on `deleted`, so an editor could name a destination from a new stream (which
// accepts any field) and read the destination's stored password back from the stream.

const SECRET = "stored-password-5d2e";
const HOST = "db.customer-only.example";

const destinationConfig = {
  name: "pg",
  destinationType: "postgres",
  database: "events",
  username: "jitsu",
  password: SECRET,
  host: HOST,
};

const configs = () => new ConfigObjectsService({ prisma: deps().prisma });

async function seedObject(workspaceId: string, type: string, config: any, deleted: boolean | null = false) {
  return deps().prisma.configurationObject.create({ data: { workspaceId, type, config, deleted } });
}

/** `{ ok: true, value }` or `{ ok: false, error }`, so a test can assert on how a call ended */
async function outcome<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: any }> {
  return promise.then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error })
  );
}

describe("creating an object with a cloneId", () => {
  it("refuses a stream that clones a destination: a stream takes any field, and would hold the stored password", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const destination = await seedObject(workspace.id, "destination", destinationConfig);
    const res = await outcome(
      configs().create(
        user,
        workspace.id,
        "stream",
        { name: "leak", password: MASKED_SECRET, cloneId: destination.id },
        { generateId: true }
      )
    );
    expect(res.ok).toBe(false);
    expect((res as any).error?.status).toBe(404);
  });

  it("stores no stream and hands out nothing of the destination", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const destination = await seedObject(workspace.id, "destination", destinationConfig);
    await outcome(
      configs().create(
        user,
        workspace.id,
        "stream",
        { name: "leak", password: MASKED_SECRET, cloneId: destination.id },
        { generateId: true }
      )
    );
    const streams = await configs().list(user, workspace.id, "stream");
    expect(JSON.stringify(streams)).not.toContain(SECRET);
    const stored = await deps().prisma.configurationObject.findMany({ where: { type: "stream" } });
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(streams).toHaveLength(0);
  });

  it("refuses a clone of an object that was deleted", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const gone = await seedObject(workspace.id, "destination", destinationConfig, true);
    const res = await outcome(
      configs().create(
        user,
        workspace.id,
        "destination",
        { ...destinationConfig, name: "copy", password: MASKED_SECRET, cloneId: gone.id },
        { generateId: true }
      )
    );
    expect(res.ok).toBe(false);
    expect((res as any).error?.status).toBe(404);
  });

  it("refuses a clone of an object of another workspace", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const other = await seedWorkspace({ role: "editor" });
    const foreign = await seedObject(other.workspace.id, "destination", destinationConfig);
    const res = await outcome(
      configs().create(
        user,
        workspace.id,
        "destination",
        { ...destinationConfig, name: "copy", password: MASKED_SECRET, cloneId: foreign.id },
        { generateId: true }
      )
    );
    expect(res.ok).toBe(false);
    expect((res as any).error?.status).toBe(404);
  });

  it("still restores the secrets of a live object of the same type", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const original = await seedObject(workspace.id, "destination", destinationConfig);
    const { id } = await configs().create(
      user,
      workspace.id,
      "destination",
      { ...destinationConfig, name: "copy", password: MASKED_SECRET, cloneId: original.id },
      { generateId: true }
    );
    const copy = (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
    expect(copy).toMatchObject({ name: "copy", password: SECRET, host: HOST });
  });

  it("does not mind a cloneId when no value is masked: nothing is restored from it", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const { id } = await configs().create(
      user,
      workspace.id,
      "destination",
      { ...destinationConfig, name: "typed", cloneId: "not-an-object" },
      { generateId: true }
    );
    const created = (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
    expect(created).toMatchObject({ name: "typed", password: SECRET });
  });
});

// a source-only Redshift config is tested through an injected reader, so no Bulker is involved
const redshift = {
  name: "Redshift source",
  destinationType: "redshift",
  authenticationMethod: "password",
  host: "test.redshift.amazonaws.com",
  username: "reader",
  password: SECRET,
  database: "test",
  region: "us-east-1",
};

function debug() {
  const createWarehouseReader = vi.fn(
    (): WarehouseReader => ({
      sql: redshiftSql,
      preview: async () => ({ rows: [{ jitsu_connection_test: 1 }], columns: [], truncated: false }),
      close: async () => {},
      columns: async () => [],
      async *stream() {},
    })
  );
  return { svc: new DebugService({ prisma: deps().prisma, createWarehouseReader }), createWarehouseReader };
}

describe("testing a connection with a cloneId", () => {
  it("does not restore secrets from an object of another type, even one with the same host", async () => {
    vi.stubEnv("BULKER_URL", undefined);
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const other = await seedObject(workspace.id, "misc", redshift);
    const f = debug();
    const res = await outcome(
      f.svc.testConnection(user, workspace.id, "destination", {
        config: { ...redshift, password: MASKED_SECRET, cloneId: other.id },
      })
    );
    expect(f.createWarehouseReader).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect((res as any).error?.status).toBe(404);
  });

  it("does not restore secrets from a deleted object", async () => {
    vi.stubEnv("BULKER_URL", undefined);
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const gone = await seedObject(workspace.id, "destination", redshift, true);
    const f = debug();
    const res = await outcome(
      f.svc.testConnection(user, workspace.id, "destination", {
        config: { ...redshift, password: MASKED_SECRET, cloneId: gone.id },
      })
    );
    expect(f.createWarehouseReader).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});

const PKG = { package: "airbyte/source-github", version: "1.0.0" };
const sync = () => new SyncService({ prisma: deps().prisma, pgPool: deps().pgPool, clickhouse: deps().clickhouse });

function captureCheck() {
  const posted: any[] = [];
  server.use(
    http.post("http://syncctl.test.local/check", async ({ request }) => {
      posted.push(await request.json());
      return HttpResponse.json({ ok: true });
    })
  );
  return posted;
}

describe("checking a service source with an id or a cloneId", () => {
  it("does not restore secrets from an object of another type named by cloneId", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const other = await seedObject(workspace.id, "misc", { name: "x", credentials: { token: SECRET } });
    const posted = captureCheck();
    const res = await sync().triggerSourceCheck(user, workspace.id, {
      config: { ...PKG, credentials: { token: MASKED_SECRET }, cloneId: other.id },
      storageKey: `${workspace.id}_x_hash_q1`,
    });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/invalid service id/) });
    expect(JSON.stringify(posted)).not.toContain(SECRET);
    expect(posted).toHaveLength(0);
  });

  it("does not restore secrets from an object of another type named by id", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const other = await seedObject(workspace.id, "misc", { name: "x", credentials: { token: SECRET } });
    const posted = captureCheck();
    await sync().triggerSourceCheck(user, workspace.id, {
      config: { id: other.id, ...PKG, credentials: { token: MASKED_SECRET } },
      storageKey: `${workspace.id}_x_hash_q1`,
    });
    expect(JSON.stringify(posted)).not.toContain(SECRET);
  });

  it("does not restore secrets from a deleted service", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const gone = await seedObject(
      workspace.id,
      "service",
      { name: "gone", ...PKG, credentials: { token: SECRET } },
      true
    );
    const posted = captureCheck();
    await sync().triggerSourceCheck(user, workspace.id, {
      config: { ...PKG, credentials: { token: MASKED_SECRET }, cloneId: gone.id },
      storageKey: `${workspace.id}_x_hash_q1`,
    });
    expect(JSON.stringify(posted)).not.toContain(SECRET);
  });

  it("refuses an id of another workspace, even when that object is deleted or not a service", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const other = await seedWorkspace({ role: "editor" });
    const foreign = [
      await seedObject(other.workspace.id, "service", { name: "gone", ...PKG, credentials: { token: SECRET } }, true),
      await seedObject(other.workspace.id, "misc", { name: "x", credentials: { token: SECRET } }),
      await seedObject(other.workspace.id, "service", { name: "live", ...PKG, credentials: { token: SECRET } }),
    ];
    const posted = captureCheck();
    for (const obj of foreign) {
      for (const named of [{ id: obj.id }, { cloneId: obj.id }]) {
        for (const credentials of [{ token: MASKED_SECRET }, { token: "typed" }]) {
          const res = await sync().triggerSourceCheck(user, workspace.id, {
            config: { ...named, ...PKG, credentials },
            storageKey: `${workspace.id}_x_hash_q1`,
          });
          expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/invalid service id/) });
        }
      }
    }
    expect(posted).toHaveLength(0);
  });

  it("refuses a foreign `id` even when `cloneId` names a service of this workspace", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const other = await seedWorkspace({ role: "editor" });
    const mine = await seedObject(workspace.id, "service", { name: "mine", ...PKG, credentials: { token: SECRET } });
    const foreign = await seedObject(other.workspace.id, "service", { name: "theirs", ...PKG, credentials: {} });
    const posted = captureCheck();
    const res = await sync().triggerSourceCheck(user, workspace.id, {
      config: { id: foreign.id, cloneId: mine.id, ...PKG, credentials: { token: MASKED_SECRET } },
      storageKey: `${workspace.id}_x_hash_q1`,
    });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/invalid service id/) });
    expect(posted).toHaveLength(0);
  });

  it("does not restore secrets from a service whose deleted flag is null", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const unknown = await seedObject(
      workspace.id,
      "service",
      { name: "null-flag", ...PKG, credentials: { token: SECRET } },
      null
    );
    const posted = captureCheck();
    await sync().triggerSourceCheck(user, workspace.id, {
      config: { cloneId: unknown.id, ...PKG, credentials: { token: MASKED_SECRET } },
      storageKey: `${workspace.id}_x_hash_q1`,
    });
    expect(JSON.stringify(posted)).not.toContain(SECRET);
  });

  it("still restores the secrets of a live service", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const live = await seedObject(workspace.id, "service", { name: "live", ...PKG, credentials: { token: SECRET } });
    const posted = captureCheck();
    for (const named of [{ id: live.id }, { cloneId: live.id }]) {
      await sync().triggerSourceCheck(user, workspace.id, {
        config: { ...named, ...PKG, credentials: { token: MASKED_SECRET } },
        storageKey: `${workspace.id}_${live.id}_hash_q1`,
      });
    }
    expect(posted).toHaveLength(2);
    for (const body of posted) expect(body.source.credentials.token).toBe(SECRET);
  });
});
