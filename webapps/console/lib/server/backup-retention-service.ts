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
  // Everything that can go wrong — transport, a non-ok payload, a payload
  // that fails the BillingSettings parse — is the same outcome for the
  // caller: the plan is unverified, 503.
  try {
    const settings: any = await rpc(`${getEeConnection().host}api/billing/settings`, {
      method: "GET",
      query: { workspaceId, email: user.email },
      headers: {
        "Content-Type": "application/json",
        ...(req ? eeAuthHeadersOrServiceToken(req, user) : serviceTokenHeaders()),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!settings?.ok) {
      throw new Error(`billing/settings returned ok=false: ${settings?.error ?? "unknown error"}`);
    }
    return getBackupRetentionCapDays(parseBillingSettings(settings));
  } catch (e) {
    log.atError().withCause(e).log(`Can't verify the plan of workspace ${workspaceId} for a backup retention change`);
    throw new ApiError(PLAN_UNVERIFIED, { status: 503 });
  }
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
        // Deleting a workspace only sets `deleted` and leaves WorkspaceAccess
        // rows intact, so without this filter a former member would still pass
        // verifyAccess and could read or change retention (and trigger
        // provisioning) on a deleted workspace. ee-api's s3-init and the
        // reconciler both ignore deleted workspaces; this route matches them.
        where: { deleted: false, OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] },
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

  /**
   * The plan cap for display/audit: `undefined` rather than a throw when the
   * plan can't be verified, so a billing outage degrades a read to the fleet
   * default instead of breaking the settings page. Authorization uses the
   * throwing form — see {@link update}.
   */
  private async capDaysForDisplay(
    workspaceId: string,
    user: SessionUser,
    req?: NextApiRequest
  ): Promise<{ capDays?: number; error?: unknown }> {
    try {
      return { capDays: await this.deps.verifyCapDays(workspaceId, user, req) };
    } catch (error) {
      return { error };
    }
  }

  async get(
    user: SessionUser,
    workspaceIdOrSlug: string,
    opts: { req?: NextApiRequest } = {}
  ): Promise<BackupRetentionState> {
    const workspace = await this.getWorkspace(workspaceIdOrSlug);
    await verifyAccess(user, workspace.id);
    const { row } = await this.getStoredRows(workspace.id);
    const { capDays } = await this.capDaysForDisplay(workspace.id, user, opts.req);
    return describeBackupRetention(workspace.featuresEnabled, row?.value, capDays);
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
    const { row, staleRows } = await this.getStoredRows(workspace.id);
    // `locked` mirrors what the GET reports: the nobackup flag only governs
    // when no explicit row overrides it (see describeBackupRetention).
    const locked = describeBackupRetention(workspace.featuresEnabled, row?.value).locked;
    // Cheap checks first (presets, the admin lock, the 0-days acknowledgement)
    // against the free cap — these reject without ever touching billing.
    const early = validateBackupRetentionChange(change, { capDays: FREE_BACKUP_RETENTION_CAP_DAYS, locked });
    if (early && early.code !== "plan_cap") {
      throw new ApiError(early.message, { status: early.code === "locked" ? 403 : 400, responseObject: early });
    }
    // The plan is only consulted when it has something to authorize — a window
    // above the free cap. A 0/7-day change is allowed on every plan, so it must
    // not wait on (or be delayed by) ee-api; the cap then stays unknown, which
    // only makes the audit entry below less precise.
    let capDays: number | undefined;
    if (early?.code === "plan_cap") {
      const resolved = await this.capDaysForDisplay(workspace.id, user, opts.req);
      if (resolved.capDays === undefined) {
        // Fail closed: a request above the free cap is only allowed against a
        // plan we actually verified.
        throw resolved.error;
      }
      capDays = resolved.capDays;
      const error = validateBackupRetentionChange(change, { capDays, locked });
      if (error) {
        throw new ApiError(error.message, { status: 403, responseObject: error });
      }
    }

    const prev = describeBackupRetention(workspace.featuresEnabled, row?.value, capDays);
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
      // Only drop duplicates that are still exactly as we read them: the legacy
      // `[section]` POST picks a row with an unordered findFirst, so one of
      // these may have just received someone's queue/logs/Mongo edit. Matching
      // on the observed updatedAt leaves such a row alone (the next write
      // heals it) instead of destroying that save.
      await this.deps.prisma.workspaceOptions.deleteMany({
        where: { OR: staleRows.map(r => ({ id: r.id, updatedAt: r.updatedAt })) },
      });
    }
    const next = describeBackupRetention(workspace.featuresEnabled, newValue, capDays);
    await workspaceAuditLog(
      user,
      workspace.id,
      "updated",
      {
        // On the default with no verified plan the effective number is ee-api's
        // to resolve; record the state, not a guess.
        prevVersion:
          prev.source === "default" && capDays === undefined
            ? { backupRetentionSource: prev.source }
            : { backupRetentionHours: prev.retentionHours, backupRetentionSource: prev.source },
        newVersion: { backupRetentionHours: next.retentionHours, backupRetentionSource: next.source },
        workspaceName: workspace.name,
      },
      opts.req
    );
    await withProductAnalytics(
      p =>
        p.track("backup_retention_changed", {
          // omitted when the previous value was an unverified default — see the audit entry
          ...(prev.source === "default" && capDays === undefined ? {} : { previousDays: prev.retentionHours / 24 }),
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
