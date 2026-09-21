import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { deps, seedWorkspace } from "./support/harness";
import { migrateReverseSyncSettings } from "../../lib/server/migrate-reverse-sync-settings";
import { readReverseSync } from "../../lib/server/reverse-sync-export";
import {
  GoogleAudienceCredentials,
  GoogleManagedAudience,
} from "@jitsu/destination-functions/src/functions/google-ads-reverse/meta";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { ModelDefinition, ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";
import { googleAudienceStateStream } from "@jitsu/destination-functions/src/functions/google-ads-reverse/state";
async function fixture(phase: "ready" | "submitting" = "ready") {
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
      config: { warehouseId: warehouse.id, query: "select id from users", primaryKey: ["id"] },
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
  const audience = await prisma.configurationObject.create({
    data: {
      id: `retl-google-${contentHash(link.id)}`,
      workspaceId: workspace.id,
      type: "reverse-google-audience",
      config: {
        version: 1,
        phase,
        destinationId: destination.id,
        syncId: link.id,
        configBinding: contentHash(GoogleAudienceCredentials.parse(credentials)),
        creationNonce: "a".repeat(64),
        displayName: "Legacy",
        integrationCode: `jitsu-retl-${"a".repeat(64)}`,
        customerId: "1234567890",
        membershipDays: 540,
        ...(phase === "ready" ? { audienceId: "123" } : {}),
      },
    },
  });
  const options = ReverseSyncOptions.parse({
    name: "Legacy",
    stream: "audience",
    mode: "mirror",
    mapping: { email: "id" },
    disabled: true,
    streamOptions:
      phase === "ready" ? { audienceId: "123", managedAudienceId: audience.id, customerMatchTermsAccepted: true } : {},
  });
  await prisma.configurationObjectLink.update({
    where: { id: link.id },
    data: { data: options as Prisma.InputJsonObject },
  });
  await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "reverse-sync-setup",
      config: {
        syncId: link.id,
        ready: phase === "ready",
        input: {
          audience: { kind: "managed", displayName: "Legacy", exclusiveManagementConfirmed: true },
          customerMatchTermsAccepted: true,
        },
      },
    },
  });
  return { prisma, workspace, model, warehouse, destination, credentials, link, audience, options };
}
describe("legacy setup migration", () => {
  it("preserves target/revision, acknowledged checkpoint and pending delivery exactly", async () => {
    const f = await fixture();
    const managed = GoogleManagedAudience.parse({
      id: f.audience.id,
      syncId: f.link.id,
      customerId: "1234567890",
      audienceId: "123",
      displayName: "Legacy",
      integrationCode: `jitsu-retl-${"a".repeat(64)}`,
      membershipDays: 540,
    });
    // Match the old exporter using PostgreSQL JSONB key ordering, not pre-insert JS objects.
    const original = await f.prisma.configurationObjectLink.findUniqueOrThrow({
      where: { id: f.link.id },
      include: { to: true, from: true },
    });
    const { name, schedule, timezone, checkpointEvery, disabled, ...delivery } = ReverseSyncOptions.parse(
      original.data
    );
    const revision = createHash("sha256")
      .update(
        JSON.stringify({
          model: ModelDefinition.parse(original.from.config),
          warehouse: f.warehouse.config,
          destination: { ...(original.to.config as object), reverseManagedAudience: managed },
          options: delivery,
        })
      )
      .digest("hex");
    await f.prisma.reverse_sync_control.create({
      data: {
        workspace_id: f.workspace.id,
        sync_id: f.link.id,
        run_id: "logical",
        revision,
        target_hash: "b".repeat(64),
        mode: "mirror",
        extraction: "full",
        phase: "finish_pending",
        artifact_head: Buffer.from("unchanged-pointer"),
        finish_result: Buffer.from("unchanged-receipt"),
      },
    });
    await f.prisma.source_state.create({
      data: { sync_id: f.link.id, stream: "_REVERSE_ETL_", state: { private: "checkpoint" } },
    });
    const control = await f.prisma.reverse_sync_control.findFirstOrThrow({ where: { sync_id: f.link.id } });
    expect(await migrateReverseSyncSettings(f.prisma, f.workspace.id)).toEqual({ migrated: 1 });
    expect(await f.prisma.reverse_sync_control.findFirst({ where: { sync_id: f.link.id } })).toEqual(control);
    expect(
      (
        await f.prisma.source_state.findUniqueOrThrow({
          where: { sync_id_stream: { sync_id: f.link.id, stream: "_REVERSE_ETL_" } },
        })
      ).state
    ).toEqual({ private: "checkpoint" });
    expect((await f.prisma.configurationObjectLink.findUniqueOrThrow({ where: { id: f.link.id } })).data).toEqual(
      f.options
    );
    await f.prisma.configurationObjectLink.update({
      where: { id: f.link.id },
      data: { data: { ...f.options, disabled: false } as Prisma.InputJsonObject },
    });
    const exported = await readReverseSync(f.prisma, f.link.id);
    expect(exported?.configRevision).toBe(revision);
    expect(exported?.destination.reverseManagedAudience).toEqual(managed);
    expect(await migrateReverseSyncSettings(f.prisma, f.workspace.id)).toEqual({ migrated: 0 });
  });
  it("moves uncertain creation to runtime state without making another Google call", async () => {
    const f = await fixture("submitting");
    await migrateReverseSyncSettings(f.prisma, f.workspace.id);
    expect(
      (
        await f.prisma.source_state.findUniqueOrThrow({
          where: { sync_id_stream: { sync_id: f.link.id, stream: googleAudienceStateStream } },
        })
      ).state
    ).toMatchObject({ phase: "submitting", managed: { integrationCode: `jitsu-retl-${"a".repeat(64)}` } });
    expect((await f.prisma.configurationObjectLink.findUniqueOrThrow({ where: { id: f.link.id } })).data).toMatchObject(
      { streamOptions: { audience: { kind: "managed", displayName: "Legacy" } } }
    );
    expect(
      await f.prisma.configurationObject.count({
        where: { workspaceId: f.workspace.id, type: { in: ["reverse-sync-setup", "reverse-google-audience"] } },
      })
    ).toBe(0);
  });
  it("refuses enabled syncs and rolls back without deleting old evidence", async () => {
    const f = await fixture();
    await f.prisma.configurationObjectLink.update({
      where: { id: f.link.id },
      data: { data: { ...f.options, disabled: false } as Prisma.InputJsonObject },
    });
    await expect(migrateReverseSyncSettings(f.prisma, f.workspace.id)).rejects.toThrow("Pause");
    expect(await f.prisma.configurationObject.findUnique({ where: { id: f.audience.id } })).not.toBeNull();
  });
  it("never adopts caller-supplied proof when runtime state is absent", async () => {
    const f = await fixture();
    await f.prisma.configurationObjectLink.update({
      where: { id: f.link.id },
      data: { data: { ...f.options, disabled: false } as Prisma.InputJsonObject },
    });
    await expect(readReverseSync(f.prisma, f.link.id)).rejects.toThrow("migration");
  });
  it("rolls back incomplete settings when runtime evidence conflicts", async () => {
    const f = await fixture("submitting");
    await f.prisma.source_state.create({
      data: { sync_id: f.link.id, stream: googleAudienceStateStream, state: { other: "evidence" } },
    });
    await expect(migrateReverseSyncSettings(f.prisma, f.workspace.id)).rejects.toThrow("different evidence");
    expect((await f.prisma.configurationObjectLink.findUniqueOrThrow({ where: { id: f.link.id } })).data).toEqual(
      f.options
    );
    expect(await f.prisma.configurationObject.findUnique({ where: { id: f.audience.id } })).not.toBeNull();
  });
  it("refuses a still-running worker even when the sync is paused", async () => {
    const f = await fixture();
    await f.prisma.source_task.create({
      data: { task_id: "active", sync_id: f.link.id, status: "RUNNING", package: "jitsu/retl-runner", version: "test" },
    });
    await expect(migrateReverseSyncSettings(f.prisma, f.workspace.id)).rejects.toThrow("Drain");
    expect(await f.prisma.configurationObject.findUnique({ where: { id: f.audience.id } })).not.toBeNull();
  });
});
