import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import { reverseMetaResults } from "../../lib/server/reverse-meta-results";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { MetaAudienceOptions } from "@jitsu/destination-functions/src/functions/facebook/reverse-meta";
const marker = `jitsu-retl-${"a".repeat(64)}`;
async function fixture(managed = true, stream = "audience") {
  const { workspace } = await seedWorkspace();
  const { prisma } = deps();
  const model = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "model", config: {} },
  });
  const destination = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: { destinationType: "facebook-conversions", accessToken: "private-token" },
    },
  });
  const streamOptions =
    stream === "conversions"
      ? { pixelId: "789" }
      : {
          accountId: "123",
          audience: managed ? { kind: "managed", name: "Customers" } : { kind: "existing", audienceId: "456" },
          exclusiveManagementConfirmed: managed,
        };
  const link = await prisma.configurationObjectLink.create({
    data: {
      workspaceId: workspace.id,
      fromId: model.id,
      toId: destination.id,
      type: "reverse-sync",
      data: {
        stream,
        mode: managed && stream === "audience" ? "mirror" : "upsert",
        disabled: true,
        mapping: { email: "email" },
        streamOptions,
      },
    },
  });
  const state = {
    version: 1,
    binding: contentHash({
      workspace: workspace.id,
      sync: link.id,
      destination: destination.id,
      settings: stream === "audience" ? MetaAudienceOptions.parse(streamOptions) : {},
    }),
    marker,
    phase: "ready",
    audienceId: "456",
  };
  if (managed && stream === "audience")
    await prisma.source_state.create({ data: { sync_id: link.id, stream: "_REVERSE_ETL_META_AUDIENCE_", state } });
  const runId = randomUUID();
  const taskId = randomUUID();
  const counts = {
    total: 0,
    prepared: 0,
    unconfirmed: 0,
    pending: 0,
    accepted: 0,
    rejected: 0,
    partial: 0,
    cancelled: 0,
  };
  const stats = {
    version: 1,
    runId,
    observedAt: "2026-10-08T00:00:00Z",
    upsert: counts,
    remove: counts,
    records: { accepted: 0, pending: 0, rejected: 0 },
    snapshot: { sourceRows: 5000, uniqueMembers: 5000, projectedMembers: 5000, excludedRows: 0 },
  };
  await prisma.source_task.create({
    data: {
      sync_id: link.id,
      task_id: taskId,
      package: "jitsu/retl-runner",
      version: "test",
      status: "COMPLETE",
      metrics: { reverseDelivery: stats, secret: "never-return" },
    },
  });
  await prisma.reverse_sync_control.create({
    data: {
      workspace_id: workspace.id,
      sync_id: link.id,
      run_id: runId,
      revision: "r",
      target_hash: "t",
      mode: "mirror",
      extraction: "full",
      phase: "complete",
    },
  });
  let calls = 0;
  server.use(
    http.get("https://graph.facebook.com/v26.0/456", ({ request }) => {
      calls++;
      expect(request.headers.get("Authorization")).toBe("Bearer private-token");
      expect(request.url).not.toContain("private-token");
      return HttpResponse.json({
        id: "456",
        account_id: "123",
        subtype: "CUSTOM",
        description: marker,
        approximate_count_lower_bound: 2900,
        approximate_count_upper_bound: 3100,
        operation_status: { code: 200, description: "never-return" },
      });
    })
  );
  return {
    prisma,
    workspace,
    destination,
    model,
    link,
    runId,
    taskId,
    stats,
    state,
    calls: () => calls,
    read: () => reverseMetaResults(prisma, workspace.id, link.id),
  };
}
describe("Meta target reporting scope and eligibility", () => {
  it("uses the saved managed target and completed snapshot without delivery/state writes", async () => {
    const f = await fixture();
    const before = await f.prisma.source_state.findMany();
    const result = await f.read();
    expect(result).toMatchObject({
      kind: "audience",
      targetId: "456",
      denominatorRows: 5000,
      matchRate: { status: "available" },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-token|never-return|binding|jitsu-retl/);
    expect(await f.prisma.source_state.findMany()).toEqual(before);
    expect(await f.prisma.source_task.count()).toBe(1);
    expect(await f.prisma.reverse_sync_control.count()).toBe(1);
  });
  it("reads paused syncs after the rollout flag is removed", async () => {
    const f = await fixture();
    await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
    expect(await f.read()).toMatchObject({ kind: "audience" });
  });
  it("never reads foreign, deleted, or cross-workspace destination targets", async () => {
    const f = await fixture();
    await expect(reverseMetaResults(f.prisma, "foreign", f.link.id)).rejects.toMatchObject({ status: 404 });
    const foreign = await seedWorkspace();
    await f.prisma.configurationObject.update({
      where: { id: f.destination.id },
      data: { workspaceId: foreign.workspace.id },
    });
    await expect(f.read()).rejects.toMatchObject({ status: 404 });
    expect(f.calls()).toBe(0);
    await f.prisma.configurationObject.update({
      where: { id: f.destination.id },
      data: { workspaceId: f.workspace.id, deleted: true },
    });
    await expect(f.read()).rejects.toMatchObject({ status: 404 });
  });
  it.each(["missing", "submitting", "binding", "malformed"])(
    "does not contact Meta for %s managed provisioning state",
    async kind => {
      const f = await fixture();
      if (kind === "missing") await f.prisma.source_state.deleteMany({ where: { sync_id: f.link.id } });
      else
        await f.prisma.source_state.updateMany({
          where: { sync_id: f.link.id },
          data: {
            state:
              kind === "malformed"
                ? {}
                : { ...f.state, ...(kind === "submitting" ? { phase: "submitting" } : { binding: "wrong" }) },
          },
        });
      expect(await f.read()).toMatchObject({
        kind: "unavailable",
        reason: ["binding", "malformed"].includes(kind) ? "state-mismatch" : "no-target",
      });
      expect(f.calls()).toBe(0);
    }
  );
  it.each(["FAILED", "RUNNING", "PENDING", "old-stats", "incomplete-control", "different-run"])(
    "excludes %s from match-rate eligibility while retaining audience size",
    async kind => {
      const f = await fixture();
      if (kind === "old-stats") {
        const { snapshot, ...stats } = f.stats;
        await f.prisma.source_task.update({
          where: { task_id: f.taskId },
          data: { metrics: { reverseDelivery: stats } },
        });
      } else if (kind === "incomplete-control" || kind === "different-run")
        await f.prisma.reverse_sync_control.updateMany({
          where: { sync_id: f.link.id },
          data: kind === "incomplete-control" ? { phase: "new" } : { run_id: randomUUID() },
        });
      else await f.prisma.source_task.update({ where: { task_id: f.taskId }, data: { status: kind } });
      expect(await f.read()).toMatchObject({
        kind: "audience",
        size: { status: "available" },
        matchRate: { status: "unavailable", reason: "no-snapshot" },
      });
    }
  );
  it("shows existing-audience size without deriving a match rate", async () => {
    const f = await fixture(false);
    expect(await f.read()).toMatchObject({
      kind: "audience",
      matchRate: { status: "unavailable", reason: "not-eligible" },
    });
  });
  it("returns conversion quality and gracefully reports missing reporting permissions", async () => {
    const f = await fixture(false, "conversions");
    server.use(
      http.get("https://graph.facebook.com/v26.0/dataset_quality", ({ request }) => {
        expect(new URL(request.url).searchParams.get("dataset_id")).toBe("789");
        return HttpResponse.json({
          web: [{ event_name: "Purchase", event_match_quality: { composite_score: 8 }, acr: { percentage: 20 } }],
        });
      })
    );
    expect(await f.read()).toMatchObject({
      kind: "conversions",
      events: [{ eventName: "Purchase", emq: { value: 8 } }],
    });
    server.use(
      http.get("https://graph.facebook.com/v26.0/dataset_quality", () =>
        HttpResponse.json({ error: { code: 200, message: "private-token" } }, { status: 403 })
      )
    );
    expect(await f.read()).toMatchObject({ kind: "unavailable", reason: "permissions" });
  });
});
