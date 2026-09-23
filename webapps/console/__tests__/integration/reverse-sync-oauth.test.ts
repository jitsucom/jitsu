import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import { readReverseSync } from "../../lib/server/reverse-sync-export";
import { readReverseGoogleToken, authorizeReverseRunner } from "../../lib/server/reverse-sync-oauth";
import type { NangoConfig } from "../../lib/server/oauth/nango-config";
import { seedPendingReverseRun } from "./support/reverse-pending";

const nango: NangoConfig = {
  enabled: true,
  nangoApiHost: "https://nango.test.local",
  secretKey: "nango-secret",
  publicKey: "public",
  nangoAppHost: "https://nango.test.local",
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
    oauthConnectionId: `destination.${destination.id}`,
    customerId: "1234567890",
  };
  await prisma.configurationObject.update({ where: { id: destination.id }, data: { config: credentials } });
  const options = { version: 2, stream: "audience", mode: "upsert", mapping: { email: "email" } };
  const link = await prisma.configurationObjectLink.create({
    data: { workspaceId: workspace.id, type: "reverse-sync", fromId: model.id, toId: destination.id, data: options },
  });
  const input = {
    syncId: link.id,
    workspaceId: workspace.id,
    configRevision: (await readReverseSync(prisma, link.id))!.configRevision,
  };
  let calls = 0;
  const oauth = {
    connection_id: credentials.oauthConnectionId,
    provider_config_key: "jitsu-cloud-dst-google-ads",
    credentials: {
      access_token: "google-token",
      refresh_token: "never-return",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      raw: { private: true },
    },
  };
  server.use(
    http.get("https://nango.test.local/connection/:id", ({ request, params }) => {
      calls++;
      expect(params.id).toBe(credentials.oauthConnectionId);
      expect(new URL(request.url).searchParams.get("provider_config_key")).toBe("jitsu-cloud-dst-google-ads");
      expect(request.headers.get("authorization")).toBe("Bearer nango-secret");
      return HttpResponse.json(oauth);
    })
  );
  const read = () => readReverseGoogleToken(prisma, input, nango);
  return { prisma, workspace, destination, credentials, link, options, input, oauth, read, calls: () => calls };
}
describe("reverse sync scoped Google OAuth", () => {
  it("allows paused saved-task OAuth but denies ordinary token requests and rechecks completion", async () => {
    const f = await fixture();
    const admission = await seedPendingReverseRun(f.prisma, f.link.id, f.workspace.id, f.input.configRevision);
    await f.prisma.configurationObjectLink.update({
      where: { id: f.link.id },
      data: { data: { ...f.options, disabled: true } },
    });
    await expect(f.read()).rejects.toThrow("OAuth unavailable");
    expect((await readReverseGoogleToken(f.prisma, { ...f.input, ...admission }, nango)).accessToken).toBe(
      "google-token"
    );
    server.use(
      http.get("https://nango.test.local/connection/:id", async () => {
        await f.prisma.reverse_sync_control.updateMany({ where: { sync_id: f.link.id }, data: { phase: "complete" } });
        return HttpResponse.json(f.oauth);
      })
    );
    await expect(readReverseGoogleToken(f.prisma, { ...f.input, ...admission }, nango)).rejects.toThrow(
      "OAuth unavailable"
    );
  });
  it("requires a nonempty exact service bearer token", () => {
    expect(authorizeReverseRunner("Bearer private", "private")).toBe(true);
    for (const actual of [undefined, "", "private", "Bearer privatE", "Bearer private "])
      expect(authorizeReverseRunner(actual, "private")).toBe(false);
    expect(authorizeReverseRunner("Bearer ", "")).toBe(false);
  });
  it("returns only a short-lived access token for the destination-owned connection", async () => {
    const f = await fixture();
    const token = await f.read();
    expect(token.accessToken).toBe("google-token");
    expect(Object.keys(token).sort()).toEqual(["accessToken", "expiresAt"]);
    expect(Date.parse(token.expiresAt)).toBeLessThanOrEqual(Date.now() + 300000);
    expect(JSON.stringify(token)).not.toContain("never-return");
    expect(f.calls()).toBe(1);
  });
  it.each(["workspace", "revision", "disabled", "flag", "deleted", "foreign-connection", "integration", "provider"])(
    "denies %s before requesting credentials",
    async kind => {
      const f = await fixture();
      if (kind === "workspace") f.input.workspaceId = "foreign";
      if (kind === "revision") f.input.configRevision = "0".repeat(64);
      if (kind === "disabled")
        await f.prisma.configurationObjectLink.update({
          where: { id: f.link.id },
          data: { data: { ...f.options, disabled: true } },
        });
      if (kind === "flag")
        await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
      if (kind === "deleted")
        await f.prisma.configurationObject.update({ where: { id: f.destination.id }, data: { deleted: true } });
      if (["foreign-connection", "integration", "provider"].includes(kind)) {
        await f.prisma.configurationObject.update({
          where: { id: f.destination.id },
          data: {
            config: {
              ...f.credentials,
              ...(kind === "foreign-connection" ? { oauthConnectionId: "destination.other" } : {}),
              ...(kind === "integration" ? { oauthIntegrationId: "other" } : {}),
              ...(kind === "provider" ? { destinationType: "other" } : {}),
            },
          },
        });
        f.input.configRevision = (await readReverseSync(f.prisma, f.link.id))!.configRevision;
      }
      await expect(f.read()).rejects.toThrow("OAuth unavailable");
      expect(f.calls()).toBe(0);
    }
  );
  it("rechecks admission after OAuth retrieval", async () => {
    const f = await fixture();
    server.use(
      http.get("https://nango.test.local/connection/:id", async () => {
        await f.prisma.configurationObjectLink.update({
          where: { id: f.link.id },
          data: { data: { ...f.options, disabled: true } },
        });
        return HttpResponse.json(f.oauth);
      })
    );
    await expect(f.read()).rejects.toThrow("OAuth unavailable");
  });
  it.each(["expired", "missing-token", "connection-mismatch", "provider-error"])(
    "redacts and rejects %s",
    async kind => {
      const f = await fixture();
      if (kind === "expired") f.oauth.credentials.expires_at = new Date(0).toISOString();
      if (kind === "missing-token") f.oauth.credentials.access_token = "";
      if (kind === "connection-mismatch") f.oauth.connection_id = "destination.other";
      if (kind === "provider-error")
        server.use(
          http.get("https://nango.test.local/connection/:id", () =>
            HttpResponse.json({ message: "never-return" }, { status: 401 })
          )
        );
      await expect(f.read()).rejects.toThrow(
        /^Reverse sync OAuth unavailable; verify admission, revision and Google authorization$/
      );
    }
  );
});
