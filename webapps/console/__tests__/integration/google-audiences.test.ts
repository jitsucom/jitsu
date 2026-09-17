import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { provisionGoogleAudience } from "../../lib/server/google-audiences";
import { readReverseSync } from "../../lib/server/reverse-sync-export";
import type { NangoConfig } from "../../lib/server/oauth/nango-config";

const nango: NangoConfig = {
  enabled: true,
  nangoApiHost: "https://nango.test.local",
  nangoAppHost: "https://nango.test.local",
  secretKey: "secret",
  publicKey: "public",
  callback: "https://console.test.local",
};
async function fixture() {
  const { workspace } = await seedWorkspace();
  const { prisma } = deps();
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const warehouse = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: { destinationType: "postgres", host: "localhost" },
    },
  });
  const model = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "model",
      config: { warehouseId: warehouse.id, query: "select email from users", primaryKey: ["email"] },
    },
  });
  const destination = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "destination", config: {} },
  });
  const credentials = {
    destinationType: "google-ads",
    authorized: true,
    customerId: "1234567890",
    oauthConnectionId: `destination.${destination.id}`,
  };
  await prisma.configurationObject.update({ where: { id: destination.id }, data: { config: credentials } });
  const link = await prisma.configurationObjectLink.create({
    data: { workspaceId: workspace.id, type: "reverse-sync", fromId: model.id, toId: destination.id, data: {} },
  });
  const input = {
    destinationId: destination.id,
    syncId: link.id,
    requestId: randomUUID(),
    displayName: "My audience",
    exclusiveManagementConfirmed: true,
    customerMatchTermsAccepted: true,
  };
  let remote: Record<string, unknown> | undefined;
  let loseResponse = false;
  let emptyDiscovery = false;
  let duplicateDiscovery = false;
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).startsWith("https://nango.test.local/"))
      return Response.json({
        connection_id: credentials.oauthConnectionId,
        provider_config_key: "jitsu-cloud-dst-google-ads",
        credentials: { access_token: "token", expires_at: new Date(Date.now() + 3600000).toISOString() },
      });
    expect(new URL(String(url)).origin).toBe("https://datamanager.googleapis.com");
    if (init?.method === "POST") {
      remote = {
        ...JSON.parse(init.body as string),
        id: "1234",
        name: "accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/1234",
        accessReason: "OWNED",
      };
      if (loseResponse) throw new Error("lost private response");
      return Response.json(remote);
    }
    if (new URL(String(url)).searchParams.has("filter"))
      return Response.json({
        userLists: remote && !emptyDiscovery ? (duplicateDiscovery ? [remote, remote] : [remote]) : [],
      });
    return Response.json(remote);
  });
  const create = (value: unknown = input, scope = workspace.id) =>
    provisionGoogleAudience(prisma, scope, value, nango, request);
  const bind = async (id?: string, mode = "mirror") => {
    await prisma.configurationObjectLink.update({
      where: { id: link.id },
      data: {
        data: {
          version: 2,
          stream: "audience",
          mode,
          mapping: { email: "email" },
          streamOptions: {
            audienceId: "1234",
            customerMatchTermsAccepted: true,
            ...(id ? { managedAudienceId: id } : {}),
          },
        },
      },
    });
    return readReverseSync(prisma, link.id);
  };
  const posts = () => request.mock.calls.filter(([, init]) => init?.method === "POST");
  return {
    prisma,
    workspace,
    destination,
    credentials,
    link,
    input,
    request,
    create,
    bind,
    posts,
    lose: () => {
      loseResponse = true;
    },
    empty: () => {
      emptyDiscovery = true;
    },
    duplicate: () => {
      duplicateDiscovery = true;
    },
  };
}
describe("managed Google audience provisioning and admission", () => {
  it("journals creation once, exports only server evidence and reserves it to one sync", async () => {
    const f = await fixture();
    const created = await f.create();
    expect(created).toMatchObject({ status: "ready", audienceId: "1234" });
    expect(await f.create()).toEqual(created);
    expect(f.posts()).toHaveLength(1);
    const sent = JSON.parse(f.posts()[0][1]!.body as string);
    expect(sent.integrationCode).not.toBe(created.id.replace("retl-google-", "jitsu-retl-"));
    expect(created).not.toHaveProperty("integrationCode");
    expect(sent).not.toHaveProperty("creationNonce");
    const config = await f.bind(created.id);
    expect(config!.destination.reverseManagedAudience).toMatchObject({
      id: created.id,
      syncId: f.link.id,
      audienceId: "1234",
      membershipDays: 540,
    });
    const other = await f.prisma.configurationObjectLink.create({
      data: {
        workspaceId: f.workspace.id,
        type: "reverse-sync",
        fromId: f.link.fromId,
        toId: f.destination.id,
        data: config!.options as any,
      },
    });
    await expect(readReverseSync(f.prisma, other.id)).rejects.toThrow("binding");
  });
  it("permits only one creation POST across concurrent requests", async () => {
    const f = await fixture();
    await Promise.all([f.create(), f.create(), f.create()]);
    expect(f.posts()).toHaveLength(1);
    expect(await f.create()).toMatchObject({ status: "ready", audienceId: "1234" });
  });
  it("discovers a lost create response without resubmitting", async () => {
    const f = await fixture();
    f.lose();
    await expect(f.create()).rejects.toThrow("same requestId");
    expect(await f.create()).toMatchObject({ status: "ready", audienceId: "1234" });
    expect(f.posts()).toHaveLength(1);
  });
  it("keeps absent or ambiguous creation unresolved without another POST", async () => {
    const f = await fixture();
    f.lose();
    await expect(f.create()).rejects.toThrow("same requestId");
    f.duplicate();
    await expect(f.create()).rejects.toThrow("same requestId");
    f.empty();
    expect(await f.create()).toMatchObject({ status: "pending" });
    expect(f.posts()).toHaveLength(1);
  });
  it("rejects changed intent and account binding, even with the same request ID", async () => {
    const f = await fixture();
    const created = await f.create();
    await expect(f.create({ ...f.input, displayName: "Changed" })).rejects.toThrow("binding");
    await f.prisma.configurationObject.update({
      where: { id: f.destination.id },
      data: { config: { ...f.credentials, customerId: "9999999999" } },
    });
    await expect(f.create()).rejects.toThrow("binding");
    await expect(f.bind(created.id)).rejects.toThrow("binding");
    expect(f.posts()).toHaveLength(1);
  });
  it.each([
    "foreign-workspace",
    "disabled-rollout",
    "unauthorized",
    "foreign-oauth",
    "wrong-destination",
    "no-consent",
  ])("rejects %s before external I/O", async kind => {
    const f = await fixture();
    if (kind === "disabled-rollout")
      await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
    if (["unauthorized", "foreign-oauth", "wrong-destination"].includes(kind))
      await f.prisma.configurationObject.update({
        where: { id: f.destination.id },
        data: {
          config: {
            ...f.credentials,
            ...(kind === "unauthorized" ? { authorized: false } : {}),
            ...(kind === "foreign-oauth" ? { oauthConnectionId: "destination.other" } : {}),
            ...(kind === "wrong-destination" ? { destinationType: "other" } : {}),
          },
        },
      });
    await expect(
      f.create(
        kind === "no-consent" ? { ...f.input, exclusiveManagementConfirmed: false } : f.input,
        kind === "foreign-workspace" ? "foreign" : f.workspace.id
      )
    ).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it("strips forged destination proof and preserves existing-audience add/remove only", async () => {
    const f = await fixture();
    await f.prisma.configurationObject.update({
      where: { id: f.destination.id },
      data: { config: { ...f.credentials, reverseManagedAudience: { audienceId: "1234" } } },
    });
    expect((await f.bind(undefined, "upsert"))!.destination).not.toHaveProperty("reverseManagedAudience");
    await expect(f.bind()).rejects.toThrow("Jitsu-managed");
    await expect(f.bind(`retl-google-${"a".repeat(64)}`)).rejects.toThrow("binding");
  });
});
