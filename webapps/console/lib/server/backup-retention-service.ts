import { NextApiRequest } from "next";
import { PrismaClient } from "@prisma/client";
import { getLog, requireDefined, rpc } from "juava";
import { db } from "./db";
import { verifyAccess, verifyAccessWithRole } from "../api";
import { ApiError } from "../shared/errors";
import { parseBillingSettings, SessionUser } from "../schema";
import {
  BackupRetentionChange,
  BackupRetentionState,
  dataRetentionNamespace,
  describeBackupRetention,
  FREE_BACKUP_RETENTION_CAP_DAYS,
  getBackupRetentionCapDays,
  hasNoBackupFlag,
  validateBackupRetentionChange,
} from "../shared/data-retention";
import { workspaceAuditLog } from "./audit-log";
import { withProductAnalytics } from "./telemetry";
import { eeAuthHeadersOrServiceToken, getEeConnection, isEEAvailable, serviceTokenHeaders } from "./ee";

const log = getLog("backup-retention");

export type BackupRetentionServiceDeps = {
  prisma: PrismaClient;
  /**
   * The plan cap in days, verified against ee-api — never trusted from the
   * browser. Throws (503) when the plan can't be verified: the only reason to
   * call it is a request above the free cap, so it must fail closed.
   */
  verifyCapDays: (workspaceId: string, user: SessionUser, req?: NextApiRequest) => Promise<number>;
  /** Apply the new lifecycle rule to the bucket now (best-effort). */
  applyRetentionNow: (workspaceId: string) => Promise<void>;
};

const PLAN_UNVERIFIED = "Could not verify your subscription plan. Please try again in a few minutes.";

export async function verifyCapDaysViaEe(
  workspaceId: string,
  user: SessionUser,
  req?: NextApiRequest
): Promise<number> {
  if (!isEEAvailable()) {
    // Self-hosted: no plans, nothing to gate (and no ee-managed backups either).
    return getBackupRetentionCapDays({ planId: "self-hosted" });
  }
  let settings: any;
  try {
    settings = await rpc(`${getEeConnection().host}api/billing/settings`, {
      method: "GET",
      query: { workspaceId, email: user.email },
      headers: {
        "Content-Type": "application/json",
        ...(req ? eeAuthHeadersOrServiceToken(req, user) : serviceTokenHeaders()),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    log.atError().withCause(e).log(`Can't verify the plan of workspace ${workspaceId} for a backup retention change`);
    throw new ApiError(PLAN_UNVERIFIED, { status: 503 });
  }
  if (!settings?.ok) {
    throw new ApiError(PLAN_UNVERIFIED, { status: 503 });
  }
  return getBackupRetentionCapDays(parseBillingSettings(settings));
}

/**
 * ee-api's s3-init provisions the bucket or patches a drifted lifecycle rule,
 * so calling it right after a change applies the new window without waiting
 * for the hourly backup-retention-sync pass. Best-effort: that pass is the
 * backstop. Not for retention 0 — s3-init refuses it (nothing to provision);
 * the drain of an existing bucket is left to the sync.
 */
export async function applyRetentionNowViaEe(workspaceId: string): Promise<void> {
  if (!isEEAvailable()) {
    return;
  }
  try {
    await rpc(`${getEeConnection().host}api/s3-init?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...serviceTokenHeaders() },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    log.atWarn().withCause(e).log(`Failed to apply backup retention for workspace ${workspaceId} immediately`);
  }
}

/**
 * Self-serve event-backup retention (JITSU-202). This is the only member-
 * writable path to `backupRetentionHours`: the generic `[section]` endpoint
 * still strips the field, because it merges an unvalidated body and its saves
 * go through the "pending update / email an admin" flow. Here the value is
 * limited to the presets, capped by the plan server-side, and applied
 * immediately.
 */
export class BackupRetentionService {
  private readonly deps: BackupRetentionServiceDeps;

  constructor(deps: Partial<BackupRetentionServiceDeps> = {}) {
    this.deps = {
      prisma: deps.prisma ?? db.prisma(),
      verifyCapDays: deps.verifyCapDays ?? verifyCapDaysViaEe,
      applyRetentionNow: deps.applyRetentionNow ?? applyRetentionNowViaEe,
    };
  }

  private async getWorkspace(workspaceIdOrSlug: string) {
    return requireDefined(
      await this.deps.prisma.workspace.findFirst({
        where: { OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] },
      }),
      `Workspace ${workspaceIdOrSlug} not found`
    );
  }

  private async getStoredRows(workspaceId: string) {
    // (workspaceId, namespace) has no unique constraint; every reader of this
    // namespace (ee-api s3-connections, s3-init, the bulker export) takes the
    // freshest row. Do the same, and heal duplicates on write.
    const rows = await this.deps.prisma.workspaceOptions.findMany({
      where: { workspaceId, namespace: dataRetentionNamespace },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    return { row: rows[0], staleRows: rows.slice(1) };
  }

  async get(user: SessionUser, workspaceIdOrSlug: string): Promise<BackupRetentionState> {
    const workspace = await this.getWorkspace(workspaceIdOrSlug);
    await verifyAccess(user, workspace.id);
    const { row } = await this.getStoredRows(workspace.id);
    return describeBackupRetention(workspace.featuresEnabled, row?.value);
  }

  async update(
    user: SessionUser,
    workspaceIdOrSlug: string,
    body: unknown,
    opts: { req?: NextApiRequest } = {}
  ): Promise<BackupRetentionState> {
    const workspace = await this.getWorkspace(workspaceIdOrSlug);
    await verifyAccessWithRole(user, workspace.id, "editEntities");
    const change = BackupRetentionChange.parse(body);
    const locked = hasNoBackupFlag(workspace.featuresEnabled);
    // Cheap checks first (presets, the admin lock, the 0-days acknowledgement)
    // against the free cap; only a request above it costs a billing round-trip.
    const early = validateBackupRetentionChange(change, { capDays: FREE_BACKUP_RETENTION_CAP_DAYS, locked });
    if (early && early.code !== "plan_cap") {
      throw new ApiError(early.message, { status: early.code === "locked" ? 403 : 400, responseObject: early });
    }
    if (early?.code === "plan_cap") {
      const capDays = await this.deps.verifyCapDays(workspace.id, user, opts.req);
      const error = validateBackupRetentionChange(change, { capDays, locked });
      if (error) {
        throw new ApiError(error.message, { status: 403, responseObject: error });
      }
    }

    const { row, staleRows } = await this.getStoredRows(workspace.id);
    const prev = describeBackupRetention(workspace.featuresEnabled, row?.value);
    const retentionHours = change.retentionDays * 24;
    // Preserve every other field of the row (queue / logs retention, custom
    // Mongo, the legacy editor's pendingUpdate) — only the backup window changes.
    const existingValue =
      row?.value && typeof row.value === "object" && !Array.isArray(row.value)
        ? (row.value as Record<string, unknown>)
        : {};
    const newValue = { ...existingValue, backupRetentionHours: retentionHours };
    if (row) {
      await this.deps.prisma.workspaceOptions.update({ where: { id: row.id }, data: { value: newValue } });
    } else {
      await this.deps.prisma.workspaceOptions.create({
        data: { workspaceId: workspace.id, namespace: dataRetentionNamespace, value: newValue },
      });
    }
    if (staleRows.length > 0) {
      await this.deps.prisma.workspaceOptions.deleteMany({ where: { id: { in: staleRows.map(r => r.id) } } });
    }
    const next = describeBackupRetention(workspace.featuresEnabled, newValue);
    await workspaceAuditLog(
      user,
      workspace.id,
      "updated",
      {
        prevVersion: { backupRetentionHours: prev.retentionHours, backupRetentionSource: prev.source },
        newVersion: { backupRetentionHours: next.retentionHours, backupRetentionSource: next.source },
        workspaceName: workspace.name,
      },
      opts.req
    );
    await withProductAnalytics(
      p =>
        p.track("backup_retention_changed", {
          previousDays: prev.retentionHours / 24,
          newDays: change.retentionDays,
          previousSource: prev.source,
        }),
      { user, workspace, req: opts.req }
    );
    if (retentionHours > 0) {
      await this.deps.applyRetentionNow(workspace.id);
    }
    return next;
  }
}
