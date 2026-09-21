import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import {
  createReverseSync,
  updateReverseSync,
  deleteReverseSync,
  listReverseSyncs,
  reverseTasks,
  reverseLogs,
} from "../../lib/server/reverse-syncs";
import { readReverseSync } from "../../lib/server/reverse-sync-export";
import { reverseGoogleOptions } from "../../lib/server/reverse-google-options";
import type { NangoConfig } from "../../lib/server/oauth/nango-config";

async function fixture() {
  const { workspace, user } = await seedWorkspace();
  const { prisma } = deps();
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const warehouse = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: { destinationType: "postgres", host: "never-contact.test" },
    },
  });
  const model = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "model",
      config: {
        name: "Audience",
        warehouseId: warehouse.id,
        query: "select email from unavailable_table",
        primaryKey: ["email"],
      },
    },
  });
  const destination = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "destination", config: { name: "Google", destinationType: "google-ads" } },
  });
  const input = {
    fromId: model.id,
    toId: destination.id,
    data: {
      version: 2,
      name: "Test",
      stream: "audience",
      mode: "mirror",
      mapping: { email: "email" },
      streamOptions: {
        audience: { kind: "managed", displayName: "Test" },
        exclusiveManagementConfirmed: true,
        customerMatchTermsAccepted: true,
      },
      schedule: "",
      timezone: "Etc/UTC",
      disabled: true,
    },
  };
  return {
    prisma,
    workspace,
    user,
    model,
    destination,
    warehouse,
    input,
    create: (raw: unknown = input, key = randomUUID()) => createReverseSync(prisma, workspace.id, key, raw),
  };
}
describe("single-save Reverse ETL settings", () => {
  it("scopes Google target lookup to the workspace and returns no provider credentials", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const connectionId = `destination.${f.destination.id}`;
    await f.prisma.configurationObject.update({
      where: { id: f.destination.id },
      data: {
        config: {
          destinationType: "google-ads",
          authorized: true,
          oauthConnectionId: connectionId,
          customerId: "1234567890",
        },
      },
    });
    const nango: NangoConfig = {
      enabled: true,
      callback: "",
      publicKey: "",
      secretKey: "nango-secret",
      nangoApiHost: "https://nango.test",
      nangoAppHost: "https://nango.test",
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            connection_id: connectionId,
            provider_config_key: "jitsu-cloud-dst-google-ads",
            credentials: {
              access_token: "private-access-token",
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ userLists: [{ id: "12", displayName: "Audience" }] })));
    await expect(
      reverseGoogleOptions(f.prisma, foreign.workspace.id, f.destination.id, "audience", nango, undefined, request)
    ).rejects.toThrow("not found");
    expect(request).not.toHaveBeenCalled();
    const result = await reverseGoogleOptions(
      f.prisma,
      f.workspace.id,
      f.destination.id,
      "audience",
      nango,
      undefined,
      request
    );
    expect(result).toEqual({ options: [{ value: "12", label: "Audience (12)" }] });
    expect(request.mock.calls[1][0]).toContain(
      "https://datamanager.googleapis.com/v1/accountTypes/GOOGLE_ADS/accounts/1234567890/userLists"
    );
    expect(JSON.stringify(result)).not.toContain("private-access-token");
    request.mockRejectedValue(new Error("private provider payload"));
    await expect(
      reverseGoogleOptions(f.prisma, f.workspace.id, f.destination.id, "audience", nango, undefined, request)
    ).rejects.toThrow("Could not load Google targets");
  });
  it.each(["click-conversions", "call-conversions", "conversion-adjustments"])(
    "saves and exports %s without audience settings or provisioning",
    async stream => {
      const f = await fixture();
      const { id } = await f.create({
        ...f.input,
        data: {
          ...f.input.data,
          stream,
          mode: "upsert",
          disabled: false,
          streamOptions: { conversionActionId: "123" },
          mapping: stream === "conversion-adjustments" ? { orderId: "email" } : { conversionTimestamp: "email" },
        },
      });
      const config = await readReverseSync(f.prisma, id, f.workspace.id);
      expect(config?.options.stream).toBe(stream);
      expect(config?.options.streamOptions).toEqual({ conversionActionId: "123" });
      expect(config?.destination.reverseManagedAudience).toBeUndefined();
      await expect(
        f.create({ ...f.input, data: { ...f.input.data, stream, streamOptions: { conversionActionId: "123" } } })
      ).rejects.toThrow("insert mode");
    }
  );
  it("filters tasks before the history limit and exposes only safe batch aggregates", async () => {
    const f = await fixture();
    const { id } = await f.create();
    const counts = {
      total: 1,
      prepared: 0,
      unconfirmed: 0,
      pending: 0,
      accepted: 1,
      rejected: 0,
      partial: 0,
      cancelled: 0,
    };
    const stats = {
      version: 1,
      runId: "run",
      observedAt: "2026-01-01T00:00:00.000Z",
      upsert: counts,
      remove: { ...counts, total: 0, accepted: 0 },
      records: { accepted: 10, pending: 0, rejected: 0 },
    };
    const taskId = randomUUID();
    await f.prisma.source_task.createMany({
      data: [
        {
          task_id: taskId,
          sync_id: id,
          package: "jitsu/retl-runner",
          version: "test",
          status: "SUCCESS",
          started_at: new Date("2026-01-01"),
          metrics: { reverseDelivery: { ...stats, privateData: "secret" }, reverseRecovery: { privateData: "secret" } },
          started_by: { trigger: "manual", privateData: "secret" },
        },
        ...Array.from({ length: 101 }, () => ({
          task_id: randomUUID(),
          sync_id: id,
          package: "jitsu/retl-runner",
          version: "test",
          status: "FAILED",
          started_at: new Date("2026-02-01"),
          metrics: { reverseDelivery: { version: 99 } },
        })),
      ],
    });
    const result = await reverseTasks(f.prisma, f.workspace.id, {
      status: "SUCCESS",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ task_id: taskId, stats, trigger: "manual" });
    expect(JSON.stringify(result)).not.toMatch(/privateData|secret|reverseRecovery|started_by|metrics/);
    expect(await reverseTasks(f.prisma, "foreign", { taskId })).toEqual([]);
    expect(await reverseTasks(f.prisma, f.workspace.id, { from: "2026-03-01T00:00:00.000Z" })).toEqual([]);
    const recent = await reverseTasks(f.prisma, f.workspace.id, {});
    expect(recent).toHaveLength(100);
    expect(recent.every(t => t.stats === null && t.trigger === null)).toBe(true);
    expect((await listReverseSyncs(f.prisma, f.workspace.id))[0].latestTask?.stats).toBeNull();
    await f.prisma.source_task.update({ where: { task_id: taskId }, data: { started_at: new Date("2026-04-01") } });
    expect((await listReverseSyncs(f.prisma, f.workspace.id))[0].latestTask?.stats).toEqual(stats);
  });
  it("saves all intent on one link without preview, OAuth, provisioning or auxiliary entities", async () => {
    const f = await fixture();
    const { id } = await f.create();
    const link = await f.prisma.configurationObjectLink.findUniqueOrThrow({ where: { id } });
    expect(link.data).toMatchObject(f.input.data);
    expect(
      await f.prisma.configurationObject.count({
        where: { workspaceId: f.workspace.id, type: { in: ["reverse-sync-setup", "reverse-google-audience"] } },
      })
    ).toBe(0);
    expect(await f.prisma.source_state.count({ where: { sync_id: id } })).toBe(0);
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false });
    expect((await readReverseSync(f.prisma, id))?.options.streamOptions).toMatchObject(f.input.data.streamOptions);
    expect((await listReverseSyncs(f.prisma, f.workspace.id))[0]).toMatchObject({ settingsLocked: false });
  });
  it.each(["managed", "existing"])("saves full replacement for %s audiences", async kind => {
    const f = await fixture();
    const { id } = await f.create({
      ...f.input,
      data: {
        ...f.input.data,
        streamOptions: {
          ...f.input.data.streamOptions,
          audience: kind === "managed" ? { kind, displayName: "Test" } : { kind, audienceId: "123" },
          mirrorStrategy: "full-replace",
        },
      },
    });
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false });
    expect((await readReverseSync(f.prisma, id))?.options.mode).toBe("mirror");
  });
  it("deduplicates a lost save response directly on the link", async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = await f.create(f.input, key);
    expect(await f.create(f.input, key)).toEqual(first);
    await expect(f.create({ ...f.input, data: { ...f.input.data, name: "changed" } }, key)).rejects.toThrow(
      "already created"
    );
    expect(
      await f.prisma.configurationObjectLink.count({ where: { workspaceId: f.workspace.id, type: "reverse-sync" } })
    ).toBe(1);
  });
  it("allows complete settings edits before first run", async () => {
    const f = await fixture();
    const { id } = await f.create();
    await updateReverseSync(f.prisma, f.workspace.id, id, {
      ...f.input,
      data: { ...f.input.data, mapping: { email: "other" } },
    });
    expect((await f.prisma.configurationObjectLink.findUniqueOrThrow({ where: { id } })).data).toMatchObject({
      mapping: { email: "other" },
    });
  });
  it("locks delivery edits once provisioning or a run has started, but allows scheduling", async () => {
    const f = await fixture();
    const { id } = await f.create();
    await f.prisma.source_state.create({
      data: { sync_id: id, stream: "_REVERSE_ETL_GOOGLE_AUDIENCE_", state: { phase: "submitting" } },
    });
    await expect(
      updateReverseSync(f.prisma, f.workspace.id, id, {
        ...f.input,
        data: { ...f.input.data, mapping: { email: "other" } },
      })
    ).rejects.toThrow("locked");
    await updateReverseSync(f.prisma, f.workspace.id, id, { schedule: "0 0 * * *", timezone: "UTC" });
    expect((await listReverseSyncs(f.prisma, f.workspace.id))[0].settingsLocked).toBe(true);
  });
  it.each(["cursor", "deleteColumn"])(
    "rejects unsafe mirror model %s structurally without querying it",
    async field => {
      const f = await fixture();
      await f.prisma.configurationObject.update({
        where: { id: f.model.id },
        data: {
          config: {
            ...(f.model.config as object),
            [field]: field === "cursor" ? { column: "email", type: "string" } : "deleted",
          },
        },
      });
      await expect(f.create()).rejects.toThrow("full-query");
    }
  );
  it("keeps workspace and stream admission on Save", async () => {
    const f = await fixture();
    await expect(f.create({ ...f.input, fromId: "foreign" })).rejects.toThrow("workspace");
    await expect(f.create({ ...f.input, data: { ...f.input.data, stream: "unsupported" } })).rejects.toThrow("stream");
    await expect(
      f.create({
        ...f.input,
        data: {
          ...f.input.data,
          streamOptions: {
            audience: { kind: "existing", audienceId: "123" },
            customerMatchTermsAccepted: true,
            mirrorStrategy: "full-replace",
          },
        },
      })
    ).rejects.toThrow("exclusive");
  });
  it("retains pause/delete/log access after rollout is disabled", async () => {
    const f = await fixture();
    const { id } = await f.create();
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false });
    await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: true });
    await expect(updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false })).rejects.toThrow();
    await expect(f.create()).rejects.toThrow();
    expect(await reverseTasks(f.prisma, f.workspace.id, { syncId: id })).toEqual([]);
    await expect(reverseLogs(f.prisma, "foreign", id, "task")).rejects.toThrow("not found");
    await deleteReverseSync(f.prisma, f.workspace.id, id);
  });
  it("requires pause and no active attempts before deletion", async () => {
    const f = await fixture();
    const { id } = await f.create();
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false });
    await expect(deleteReverseSync(f.prisma, f.workspace.id, id)).rejects.toThrow("Pause");
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: true });
    await f.prisma.source_task.create({
      data: { task_id: randomUUID(), sync_id: id, package: "jitsu/retl-runner", version: "test", status: "WAITING" },
    });
    await expect(deleteReverseSync(f.prisma, f.workspace.id, id)).rejects.toThrow("Cancel");
  });
  it("checks Kubernetes-compatible cron and timezone at the API boundary", async () => {
    const f = await fixture();
    for (const data of [{ schedule: "* * * * * *" }, { schedule: "@every 1m" }, { timezone: "not/a-zone" }])
      await expect(f.create({ ...f.input, data: { ...f.input.data, ...data } })).rejects.toThrow();
  });
});
