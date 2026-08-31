import { describe, expect, it, vi } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { BackupRetentionService } from "../../lib/server/backup-retention-service";
import { dataRetentionNamespace, DEFAULT_BACKUP_RETENTION_HOURS } from "../../lib/shared/data-retention";

// Real Postgres via the harness. ee-api is replaced by the two injectable
// hooks (plan verification, immediate apply) so the tests assert exactly when
// the service reaches for billing and when it doesn't.

function svc(opts: { capDays?: number | Error } = {}) {
  const verifyCapDays = vi.fn(async () => {
    if (opts.capDays instanceof Error) {
      throw opts.capDays;
    }
    return opts.capDays ?? 7;
  });
  const applyRetentionNow = vi.fn(async () => {});
  return {
    service: new BackupRetentionService({ prisma: deps().prisma, verifyCapDays, applyRetentionNow }),
    verifyCapDays,
    applyRetentionNow,
  };
}

async function rows(workspaceId: string) {
  return deps().prisma.workspaceOptions.findMany({ where: { workspaceId, namespace: dataRetentionNamespace } });
}

describe("BackupRetentionService.get", () => {
  it("defaults a free workspace to its plan cap, not the fleet default", async () => {
    const { user, workspace } = await seedWorkspace();
    expect(await svc({ capDays: 7 }).service.get(user, workspace.id)).toEqual({
      retentionHours: 7 * 24,
      source: "default",
      locked: false,
    });
    expect(await svc({ capDays: 90 }).service.get(user, workspace.id)).toEqual({
      retentionHours: DEFAULT_BACKUP_RETENTION_HOURS,
      source: "default",
      locked: false,
    });
  });

  it("degrades to the fleet default when the plan cannot be verified", async () => {
    const { user, workspace } = await seedWorkspace();
    const broken = svc({ capDays: Object.assign(new Error("ee down"), { status: 503 }) });
    expect(await broken.service.get(user, workspace.id)).toEqual({
      retentionHours: DEFAULT_BACKUP_RETENTION_HOURS,
      source: "default",
      locked: false,
    });
  });

  it("resolves by slug and reports an explicit row", async () => {
    const { user, workspace } = await seedWorkspace();
    await deps().prisma.workspaceOptions.create({
      data: { workspaceId: workspace.id, namespace: dataRetentionNamespace, value: { backupRetentionHours: "720" } },
    });
    expect(await svc().service.get(user, workspace.slug!)).toEqual({
      retentionHours: 720,
      source: "explicit",
      locked: false,
    });
  });

  it("reports the admin nobackup flag as locked", async () => {
    const { user, workspace } = await seedWorkspace();
    await deps().prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["nobackup"] } });
    expect(await svc().service.get(user, workspace.id)).toEqual({
      retentionHours: 0,
      source: "nobackup",
      locked: true,
    });
  });

  it("denies a user without workspace access (real verifyAccess)", async () => {
    const { workspace } = await seedWorkspace();
    const { user: stranger } = await seedWorkspace();
    await expect(svc().service.get(stranger, workspace.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("BackupRetentionService.update", () => {
  it("writes a preset within the free cap, applies it, and audits the plan-aware previous value", async () => {
    const { user, workspace } = await seedWorkspace();
    const { service, applyRetentionNow } = svc({ capDays: 7 });
    const result = await service.update(user, workspace.id, { retentionDays: 7 });
    expect(result).toEqual({ retentionHours: 168, source: "explicit", locked: false });
    expect(applyRetentionNow).toHaveBeenCalledWith(workspace.id);
    const stored = await rows(workspace.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].value).toEqual({ backupRetentionHours: 168 });
    const audit = await deps().prisma.auditLog.findFirst({
      where: { workspaceId: workspace.id, type: "workspace-updated" },
      orderBy: { timestamp: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.changes).toMatchObject({
      // 7 days, not the fleet default: that is what this free workspace had
      prevVersion: { backupRetentionHours: 168, backupRetentionSource: "default" },
      newVersion: { backupRetentionHours: 168, backupRetentionSource: "explicit" },
    });
  });

  it("preserves the other fields of an existing row and heals duplicates", async () => {
    const { user, workspace } = await seedWorkspace();
    const prisma = deps().prisma;
    const stale = await prisma.workspaceOptions.create({
      data: {
        workspaceId: workspace.id,
        namespace: dataRetentionNamespace,
        value: { kafkaRetentionHours: 1, backupRetentionHours: 24 },
        updatedAt: new Date(Date.now() - 60_000),
      },
    });
    const fresh = await prisma.workspaceOptions.create({
      data: {
        workspaceId: workspace.id,
        namespace: dataRetentionNamespace,
        value: { kafkaRetentionHours: 48, customMongoDb: "mongodb://x", pendingUpdate: true },
      },
    });
    await svc().service.update(user, workspace.id, { retentionDays: 7 });
    const stored = await rows(workspace.id);
    expect(stored.map(r => r.id)).toEqual([fresh.id]);
    expect(stored[0].value).toEqual({
      kafkaRetentionHours: 48,
      customMongoDb: "mongodb://x",
      pendingUpdate: true,
      backupRetentionHours: 168,
    });
    expect(await prisma.workspaceOptions.findUnique({ where: { id: stale.id } })).toBeNull();
  });

  it("enforces the verified plan cap for values above the free cap", async () => {
    const { user, workspace } = await seedWorkspace();
    const capped = svc({ capDays: 7 });
    await expect(capped.service.update(user, workspace.id, { retentionDays: 30 })).rejects.toMatchObject({
      status: 403,
      responseObject: { code: "plan_cap" },
    });
    expect(capped.verifyCapDays).toHaveBeenCalledTimes(1);
    expect(capped.applyRetentionNow).not.toHaveBeenCalled();
    expect(await rows(workspace.id)).toHaveLength(0);

    const paid = svc({ capDays: 90 });
    expect(await paid.service.update(user, workspace.id, { retentionDays: 90 })).toMatchObject({
      retentionHours: 2160,
      source: "explicit",
    });
  });

  it("fails closed above the free cap when the plan cannot be verified", async () => {
    const { user, workspace } = await seedWorkspace();
    const broken = svc({ capDays: Object.assign(new Error("ee down"), { status: 503 }) });
    await expect(broken.service.update(user, workspace.id, { retentionDays: 90 })).rejects.toMatchObject({
      status: 503,
    });
    expect(await rows(workspace.id)).toHaveLength(0);
  });

  it("still accepts a within-free-cap change when the plan cannot be verified", async () => {
    const { user, workspace } = await seedWorkspace();
    const broken = svc({ capDays: Object.assign(new Error("ee down"), { status: 503 }) });
    expect(await broken.service.update(user, workspace.id, { retentionDays: 7 })).toMatchObject({
      retentionHours: 168,
      source: "explicit",
    });
  });

  it("requires the acknowledgement for 0 days and skips the immediate apply", async () => {
    const { user, workspace } = await seedWorkspace();
    const { service, applyRetentionNow } = svc();
    await expect(service.update(user, workspace.id, { retentionDays: 0 })).rejects.toMatchObject({
      status: 400,
      responseObject: { code: "ack_required" },
    });
    expect(await service.update(user, workspace.id, { retentionDays: 0, acknowledgeDataLoss: true })).toEqual({
      retentionHours: 0,
      source: "explicit",
      locked: false,
    });
    expect(applyRetentionNow).not.toHaveBeenCalled();
    expect((await rows(workspace.id))[0].value).toEqual({ backupRetentionHours: 0 });
  });

  it("rejects non-preset values", async () => {
    const { user, workspace } = await seedWorkspace();
    const { service } = svc();
    await expect(service.update(user, workspace.id, { retentionDays: 14 })).rejects.toMatchObject({
      status: 400,
      responseObject: { code: "not_preset" },
    });
    await expect(service.update(user, workspace.id, { retentionDays: 1.5 })).rejects.toThrow();
  });

  it("refuses changes on a nobackup-locked workspace", async () => {
    const { user, workspace } = await seedWorkspace();
    await deps().prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["nobackup"] } });
    await expect(svc().service.update(user, workspace.id, { retentionDays: 7 })).rejects.toMatchObject({
      status: 403,
      responseObject: { code: "locked" },
    });
    expect(await rows(workspace.id)).toHaveLength(0);
  });

  it("requires the editEntities role (real verifyAccessWithRole)", async () => {
    const { user, workspace } = await seedWorkspace({ role: "analyst" });
    await expect(svc().service.update(user, workspace.id, { retentionDays: 7 })).rejects.toMatchObject({
      status: 403,
    });
    expect(await rows(workspace.id)).toHaveLength(0);
  });
});
