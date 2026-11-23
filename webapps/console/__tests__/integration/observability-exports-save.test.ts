import { describe, expect, it } from "vitest";
import { createHash, randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import { observabilityExportsNamespace } from "../../lib/shared/observability-exports";
import exportsRoute from "../../pages/api/workspace/[workspaceIdOrSlug]/observability-exports/index";

// JITSU-283: saving the observability exports replaced a masked header value with the stored one without asking whether the
// endpoint had changed. An editor could save a new endpoint together with the masked headers, and the stored credentials
// were then sent to that endpoint by the next export. The sibling test route already refuses this.

const SECRET = "stored-header-secret-91c4";
const STORED = {
  enabled: true,
  endpoint: "https://otel.customer.example/v1/logs",
  headers: [{ name: "Authorization", value: SECRET }],
};

async function seedStored(workspaceId: string, value: unknown = STORED) {
  await deps().prisma.workspaceOptions.create({
    data: { workspaceId, namespace: observabilityExportsNamespace, value: value as any },
  });
}

async function storedValue(workspaceId: string): Promise<any> {
  const rows = await deps().prisma.workspaceOptions.findMany({
    where: { workspaceId, namespace: observabilityExportsNamespace },
  });
  return rows.map(r => r.value);
}

async function editorKey(role: "editor" | "analyst" = "editor") {
  const { user, workspace } = await seedWorkspace({ role });
  const secret = randomId(24);
  const token = await deps().prisma.userApiToken.create({
    data: { hint: "x***", hash: createHash(secret), userId: user.internalId },
  });
  return { workspace, bearer: `${token.id}:${secret}` };
}

async function call(method: "PUT" | "GET", bearer: string, workspaceId: string, body?: any) {
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
  await exportsRoute(
    {
      method,
      headers: { authorization: `Bearer ${bearer}` },
      query: { workspaceIdOrSlug: workspaceId },
      body,
      cookies: {},
      socket: { remoteAddress: "127.0.0.1" },
      url: "/",
    } as any,
    res
  );
  return res;
}

describe("saving the observability exports with masked header values", () => {
  it("refuses a new endpoint, and keeps what was stored", async () => {
    const { workspace, bearer } = await editorKey();
    await seedStored(workspace.id);
    const res = await call("PUT", bearer, workspace.id, {
      enabled: true,
      endpoint: "https://attacker.example/collect",
      headers: [{ name: "Authorization", value: MASKED_SECRET }],
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(await storedValue(workspace.id)).toEqual([STORED]);
  });

  it("refuses a new endpoint when only one of several headers is masked", async () => {
    const { workspace, bearer } = await editorKey();
    await seedStored(workspace.id, { ...STORED, headers: [...STORED.headers, { name: "X-Team", value: "t" }] });
    const res = await call("PUT", bearer, workspace.id, {
      enabled: true,
      endpoint: "https://attacker.example/collect",
      headers: [
        { name: "Authorization", value: MASKED_SECRET },
        { name: "X-Team", value: "new" },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(await storedValue(workspace.id)).toEqual([
      { ...STORED, headers: [...STORED.headers, { name: "X-Team", value: "t" }] },
    ]);
  });

  it("stores no mask when nothing is stored yet", async () => {
    const { workspace, bearer } = await editorKey();
    const res = await call("PUT", bearer, workspace.id, {
      enabled: true,
      endpoint: "https://attacker.example/collect",
      headers: [{ name: "Authorization", value: MASKED_SECRET }],
    });
    expect(res.statusCode).toBe(400);
    expect(await storedValue(workspace.id)).toEqual([]);
  });

  it("keeps the stored headers when the endpoint is the same", async () => {
    const { workspace, bearer } = await editorKey();
    await seedStored(workspace.id);
    const res = await call("PUT", bearer, workspace.id, {
      enabled: false,
      endpoint: ` ${STORED.endpoint} `,
      headers: [{ name: "authorization", value: MASKED_SECRET }],
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(await storedValue(workspace.id)).toEqual([
      { enabled: false, endpoint: STORED.endpoint, headers: [{ name: "authorization", value: SECRET }] },
    ]);
  });

  it("accepts a new endpoint with the header values entered again", async () => {
    const { workspace, bearer } = await editorKey();
    await seedStored(workspace.id);
    const res = await call("PUT", bearer, workspace.id, {
      enabled: true,
      endpoint: "https://otel.other.example/v1/logs",
      headers: [{ name: "Authorization", value: "typed-again" }],
    });
    expect(res.statusCode).toBe(200);
    expect(await storedValue(workspace.id)).toEqual([
      {
        enabled: true,
        endpoint: "https://otel.other.example/v1/logs",
        headers: [{ name: "Authorization", value: "typed-again" }],
      },
    ]);
  });

  it("accepts a new endpoint when no header is masked", async () => {
    const { workspace, bearer } = await editorKey();
    await seedStored(workspace.id);
    const res = await call("PUT", bearer, workspace.id, {
      enabled: true,
      endpoint: "https://otel.other.example/v1/logs",
      headers: [],
    });
    expect(res.statusCode).toBe(200);
    expect(await storedValue(workspace.id)).toEqual([
      { enabled: true, endpoint: "https://otel.other.example/v1/logs", headers: [] },
    ]);
  });

  it("still answers a read with masked values", async () => {
    const { workspace, bearer } = await editorKey();
    await seedStored(workspace.id);
    const res = await call("GET", bearer, workspace.id);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body.headers).toEqual([{ name: "Authorization", value: MASKED_SECRET }]);
  });
});
