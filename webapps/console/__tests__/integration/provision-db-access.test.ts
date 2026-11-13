import { describe, expect, it, vi } from "vitest";
import { createHash, randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { getUser } from "../../lib/api";
import { api as provisionDbApi } from "../../pages/api/[workspaceId]/ee/provision-db/index";
import credentialsRoute from "../../pages/api/[workspaceId]/ee/provision-db/credentials";

// What the EE server answers; only whether it is reached matters here, and that the password in it is not handed out.
const EE_PASSWORD = "ee-warehouse-password";
const eeRpc = vi.hoisted(() => vi.fn());
vi.mock("juava", async importOriginal => ({ ...(await importOriginal<typeof import("juava")>()), rpc: eeRpc }));
vi.mock("../../lib/server/ee", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/server/ee")>()),
  isEEAvailable: () => true,
  getEeServerConnection: () => ({ host: "http://ee.test/" }),
  eeAuthHeadersOrServiceToken: () => ({}),
}));

// The provisioned ClickHouse destination of a workspace holds the warehouse password. Reading it back through the
// provisioning routes must follow the role like the rest of the console: a role that cannot edit never gets the
// password (the normal config routes filter a provisioned destination down to its name and flag), and the credentials
// route, which asks the EE server for them, needs editEntities.
async function seedProvisioned(workspaceId: string) {
  const row = await deps().prisma.configurationObject.create({
    data: {
      workspaceId,
      type: "destination",
      config: {
        name: "Provisioned Clickhouse",
        destinationType: "clickhouse",
        provisioned: true,
        protocol: "https",
        hosts: ["ch.example:8443"],
        username: "provisioned_user",
        database: "provisioned_db",
        password: EE_PASSWORD,
      },
    },
  });
  return row.id;
}

async function bearer(userId: string, role?: string) {
  const secret = randomId(24);
  const token = await deps().prisma.userApiToken.create({
    data: { hint: "x***", hash: createHash(secret), userId, role },
  });
  return `${token.id}:${secret}`;
}

async function userOf(key: string) {
  const req: any = { headers: { authorization: `Bearer ${key}` }, query: {}, cookies: {} };
  return (await getUser({} as any, req))!;
}

async function callRoute(handler: any, key: string, query: any) {
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
    { method: "GET", headers: { authorization: `Bearer ${key}` }, query, body: undefined, cookies: {}, url: "/" },
    res
  );
  return res;
}

const getProvisioned = async (key: string, workspaceId: string) => {
  const user = await userOf(key);
  return (provisionDbApi.GET as any).handle({ user, query: { workspaceId }, req: { cookies: {}, headers: {} } });
};

async function setup() {
  const owner = await seedWorkspace({ role: "owner" });
  const analystMember = await seedWorkspace({ role: "analyst", member: false });
  await deps().prisma.workspaceAccess.create({
    data: { userId: analystMember.user.internalId, workspaceId: owner.workspace.id, role: "analyst" },
  });
  const destinationId = await seedProvisioned(owner.workspace.id);
  eeRpc.mockReset();
  eeRpc.mockResolvedValue({
    hosts: ["ch.example:8443"],
    username: "provisioned_user",
    database: "provisioned_db",
    password: EE_PASSWORD,
  });
  return {
    workspaceId: owner.workspace.id,
    destinationId,
    ownerKey: await bearer(owner.user.internalId),
    limitedAnalystKey: await bearer(owner.user.internalId, "analyst"),
    analystMemberKey: await bearer(analystMember.user.internalId),
  };
}

describe("GET /api/<workspace>/ee/provision-db", () => {
  it("never returns the warehouse password: not to an analyst-limited key, not to an analyst member, not to an owner", async () => {
    const s = await setup();
    for (const [who, key] of [
      ["analyst-limited key", s.limitedAnalystKey],
      ["analyst member", s.analystMemberKey],
      ["owner", s.ownerKey],
    ] as const) {
      const result = await getProvisioned(key, s.workspaceId);
      expect(result.provisioned, who).toBe(true);
      expect(result.destinationId, who).toBe(s.destinationId);
      expect(JSON.stringify(result), who).not.toContain(EE_PASSWORD);
      expect(result.config, who).not.toHaveProperty("password");
    }
  });

  it("still says that the workspace has a provisioned database, with its name", async () => {
    const s = await setup();
    const result = await getProvisioned(s.analystMemberKey, s.workspaceId);
    expect(result.config).toMatchObject({ id: s.destinationId, name: "Provisioned Clickhouse", provisioned: true });
  });
});

describe("GET /api/<workspace>/ee/provision-db/credentials", () => {
  it("refuses an analyst-limited key and an analyst member, and never asks the EE server", async () => {
    const s = await setup();
    for (const [who, key] of [
      ["analyst-limited key", s.limitedAnalystKey],
      ["analyst member", s.analystMemberKey],
    ] as const) {
      const res = await callRoute(credentialsRoute, key, {
        workspaceId: s.workspaceId,
        destinationId: s.destinationId,
      });
      expect(res.statusCode, who).toBe(403);
      expect(JSON.stringify(res.body ?? ""), who).not.toContain(EE_PASSWORD);
    }
    expect(eeRpc).not.toHaveBeenCalled();
  });

  it("still gives an owner the credentials", async () => {
    const s = await setup();
    const res = await callRoute(credentialsRoute, s.ownerKey, {
      workspaceId: s.workspaceId,
      destinationId: s.destinationId,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ host: "ch.example:8443", username: "provisioned_user", password: EE_PASSWORD });
    expect(eeRpc).toHaveBeenCalledTimes(1);
  });
});
