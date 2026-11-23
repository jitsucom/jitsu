import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { createHash, randomId } from "juava";
import { server } from "./support/msw";
import { deps, seedWorkspace } from "./support/harness";
import { getUser } from "../../lib/api";
import { SyncService } from "../../lib/server/sync-service";
import notificationTest from "../../pages/api/[workspaceId]/notification-test";

// JITSU-287 and JITSU-282: these paths called `verifyAccess`, which checks workspace membership (and the key's workspace)
// but never the role. An analyst member, or a key limited to the analyst role, could reset or overwrite sync state,
// cancel syncs, start the source check and discover jobs, and make the server post to a Slack URL from the request.

const sync = () => new SyncService({ prisma: deps().prisma, pgPool: deps().pgPool, clickhouse: deps().clickhouse });
const PKG = { package: "airbyte/source-github", version: "1.0.0" };

async function seedSync(workspaceId: string) {
  const prisma = deps().prisma;
  const service = await prisma.configurationObject.create({
    data: { workspaceId, type: "service", config: { name: "github", ...PKG, credentials: { token: "secret" } } },
  });
  const destination = await prisma.configurationObject.create({
    data: { workspaceId, type: "destination", config: { name: "wh", destinationType: "webhook" } },
  });
  const link = await prisma.configurationObjectLink.create({
    data: { workspaceId, fromId: service.id, toId: destination.id, type: "sync", data: {} },
  });
  return { service, link };
}

/** An API key of the user, limited to `role`, as the API resolves it from the bearer header */
async function keyUser(userId: string, role: string) {
  const secret = randomId(24);
  const token = await deps().prisma.userApiToken.create({
    data: { hint: "x***", hash: createHash(secret), userId, role },
  });
  const req: any = { headers: { authorization: `Bearer ${token.id}:${secret}` }, query: {}, cookies: {} };
  return { user: (await getUser({} as any, req))!, bearer: `${token.id}:${secret}` };
}

/** how a call ended: the status of the error it threw, or undefined when it did not throw */
async function failure(promise: Promise<unknown>): Promise<number | undefined> {
  return promise.then(
    () => undefined,
    e => e?.status ?? -1
  );
}

type Actor = { name: string; make: () => Promise<{ user: any; workspaceId: string; bearer?: string }> };

const analyst: Actor[] = [
  {
    name: "an analyst member",
    make: async () => {
      const { user, workspace } = await seedWorkspace({ role: "analyst" });
      return { user, workspaceId: workspace.id };
    },
  },
  {
    name: "an owner's key limited to the analyst role",
    make: async () => {
      const { user, workspace } = await seedWorkspace(); // owner
      const key = await keyUser(user.internalId, "analyst");
      return { user: key.user, workspaceId: workspace.id, bearer: key.bearer };
    },
  },
];

const editor: Actor = {
  name: "an editor member",
  make: async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    return { user, workspaceId: workspace.id };
  },
};

function fakeSyncctl() {
  const hits: string[] = [];
  const answer = (name: string) => () => {
    hits.push(name);
    return HttpResponse.json({ ok: true });
  };
  server.use(
    http.get("http://syncctl.test.local/cancel", answer("cancel")),
    http.post("http://syncctl.test.local/check", answer("check")),
    http.post("http://syncctl.test.local/discover", answer("discover")),
    http.post("http://syncctl.test.local/run", answer("run")),
    http.get("http://syncctl.test.local/run", answer("run"))
  );
  return hits;
}

type Op = {
  name: string;
  /** a call that must need `editEntities` */
  call: (a: { user: any; workspaceId: string }, ids: { syncId: string; serviceId: string }) => Promise<unknown>;
  /** what must not reach syncctl or the database when the call is refused */
  hit?: string;
};

const ops: Op[] = [
  {
    name: "cancelSync",
    call: (a, ids) => sync().cancelSync(a.user, a.workspaceId, { syncId: ids.syncId, taskId: "t1" }),
    hit: "cancel",
  },
  {
    name: "resetSyncState",
    call: (a, ids) => sync().resetSyncState(a.user, a.workspaceId, { syncId: ids.syncId, stream: "issues" }),
  },
  {
    name: "setSyncState",
    call: (a, ids) =>
      sync().setSyncState(a.user, a.workspaceId, { syncId: ids.syncId, stream: "issues", state: { cursor: "9" } }),
  },
  {
    name: "triggerSourceCheck",
    call: (a, ids) => sync().triggerSourceCheck(a.user, a.workspaceId, { serviceId: ids.serviceId }),
    hit: "check",
  },
  {
    name: "triggerSourceCheck with a config",
    call: (a, _ids) =>
      sync().triggerSourceCheck(a.user, a.workspaceId, {
        config: { ...PKG, credentials: { token: "typed" } },
        storageKey: `${a.workspaceId}_x_hash_q1`,
      }),
    hit: "check",
  },
  {
    name: "discoverStreams",
    call: (a, ids) => sync().discoverStreams(a.user, a.workspaceId, { serviceId: ids.serviceId }),
    hit: "discover",
  },
];

describe.each(analyst)("$name", actor => {
  it.each(ops)("is refused by $name with a 403, and nothing is done", async op => {
    const a = await actor.make();
    const { service, link } = await seedSync(a.workspaceId);
    const hits = fakeSyncctl();
    await deps().pgPool.query(
      `insert into newjitsu.source_state (sync_id, stream, state, timestamp) values ($1, 'issues', '{"cursor":"1"}', now())`,
      [link.id]
    );
    expect(await failure(op.call(a, { syncId: link.id, serviceId: service.id }))).toBe(403);
    if (op.hit) expect(hits).not.toContain(op.hit);
    const state = await deps().pgPool.query(`select state from newjitsu.source_state where sync_id = $1`, [link.id]);
    expect(state.rows).toEqual([{ state: { cursor: "1" } }]);
  });

  it("can still run a sync, which is allowed for analysts by design", async () => {
    const a = await actor.make();
    const { link } = await seedSync(a.workspaceId);
    fakeSyncctl();
    expect(await failure(sync().runSync(a.user, a.workspaceId, { syncId: link.id }, { headers: {} } as any))).not.toBe(
      403
    );
  });

  it("is refused by the Slack notification test, and no request leaves for the URL", async () => {
    const a = await actor.make();
    const posted: string[] = [];
    server.use(
      http.post("https://hooks.slack.test/services/T/B/x", () => {
        posted.push("slack");
        return HttpResponse.json({ ok: true });
      })
    );
    const key = a.bearer ?? (await keyForMember(a.user.internalId));
    const res = await callRoute(
      notificationTest,
      key,
      { slackWebhookUrl: "https://hooks.slack.test/services/T/B/x", recurringAlertsPeriodHours: 1 },
      { workspaceId: a.workspaceId }
    );
    expect(res.statusCode).toBe(403);
    expect(posted).toEqual([]);
  });
});

describe("an editor", () => {
  it.each(ops)("can still use $name", async op => {
    const a = await editor.make();
    const { service, link } = await seedSync(a.workspaceId);
    fakeSyncctl();
    expect(await failure(op.call(a, { syncId: link.id, serviceId: service.id }))).not.toBe(403);
  });

  it("changes the sync state: reset removes it, set writes it", async () => {
    const a = await editor.make();
    const { link } = await seedSync(a.workspaceId);
    const read = async () =>
      (await deps().pgPool.query(`select state from newjitsu.source_state where sync_id = $1`, [link.id])).rows;
    await sync().setSyncState(a.user, a.workspaceId, { syncId: link.id, stream: "issues", state: { cursor: "5" } });
    expect(await read()).toEqual([{ state: { cursor: "5" } }]);
    await sync().resetSyncState(a.user, a.workspaceId, { syncId: link.id, stream: "issues" });
    expect(await read()).toEqual([]);
  });
});

async function keyForMember(userId: string) {
  return (await keyUser(userId, "editor")).bearer;
}

async function callRoute(handler: any, key: string, body: any, query: any) {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, any>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
    send(b: any) {
      this.body = b;
      return this;
    },
    setHeader(k: string, v: any) {
      this.headers[k] = v;
    },
    getHeader(k: string) {
      return this.headers[k];
    },
    end() {},
  };
  await handler(
    { method: "POST", headers: { authorization: `Bearer ${key}` }, query, body, cookies: {}, url: "/" },
    res
  );
  return res;
}
