import { z } from "zod";
import { Simplify } from "type-fest";

export const DataRetentionSettings = z.object({
  kafkaRetentionHours: z.coerce.number(),
  identityStitchingRetentionDays: z.coerce.number(),
  logsRetentionDays: z.object({
    maxRecords: z.coerce.number(),
    maxHours: z.coerce.number(),
  }),
  customMongoDb: z.string().optional(),
  disableS3Archive: z.coerce.boolean().default(false).optional(),
  /**
   * Event-archive retention in hours; 0 means "no archive at all" (the
   * existing archive drains). Absent falls back to `nobackup` (= 0) and then
   * to DEFAULT_BACKUP_RETENTION_HOURS, so a row is only needed to override
   * the default. Members change it only through the dedicated
   * `backup-retention` route (presets, plan-capped, JITSU-202); the generic
   * workspace-options POST endpoint strips it, and admins may set any value
   * directly. See resolveBackupMode().
   */
  backupRetentionHours: z.coerce.number().min(0).optional(),
  pendingUpdate: z.coerce.boolean().default(false).optional(),
});

// Example of type derived from Zod schema
export type DataRetentionSettings = Simplify<z.infer<typeof DataRetentionSettings>>;

export const defaultDataRetentionSettings: DataRetentionSettings = {
  kafkaRetentionHours: 7 * 24,
  identityStitchingRetentionDays: 30,
  logsRetentionDays: {
    maxRecords: 1000,
    maxHours: 7 * 24,
  },
};

/**
 * Fleet default retention (90 days) — the ceiling for a workspace without an
 * explicit `backupRetentionHours`. What such a workspace actually gets is
 * {@link defaultBackupRetentionHours}, which never exceeds its plan cap.
 */
export const DEFAULT_BACKUP_RETENTION_HOURS = 90 * 24;

/**
 * The retention a workspace with no explicit row gets, given its plan cap
 * (JITSU-202): never longer than the plan lets a member select, so free
 * workspaces default to the free cap (7 days) and paid ones to the fleet
 * default. An unknown cap (billing unreachable) falls back to the fleet
 * default — a display-only overstatement during an outage; ee-api owns the
 * enforced value and resolves the cap from its own subscription data.
 */
export function defaultBackupRetentionHours(capDays?: number): number {
  if (typeof capDays !== "number" || !Number.isFinite(capDays) || capDays < 0) {
    return DEFAULT_BACKUP_RETENTION_HOURS;
  }
  return Math.min(DEFAULT_BACKUP_RETENTION_HOURS, capDays * 24);
}

/**
 * Resolves a workspace's event-archive retention. Every workspace archives to
 * GCS with an enforced retention; there is no unmigrated/legacy-S3 mode left
 * (the fleet backfill completed 2026-08-13, and the default now covers
 * anything without an explicit row — including newly created workspaces).
 *
 * Order: explicit `backupRetentionHours` -> `nobackup` (permanent alias for
 * 0) -> the plan-aware default (see {@link defaultBackupRetentionHours}).
 * `0` = no archive at all; it drains.
 *
 * The ee billing server mirrors this logic (`lib/data-retention.ts` in
 * jitsu-cloud-billing) to emit bulker backup connections and manage bucket
 * lifecycle rules — keep the two in sync. The raw value is parsed loosely
 * (numbers or numeric strings) because rows are written through
 * `z.coerce.number()` and may predate this field; garbage or negative values
 * are treated as unset, i.e. they fall through to `nobackup` then the default.
 *
 * The `migrated: false` variant is unreachable now; it is kept only so the
 * legacy-S3 branches still typecheck until they are deleted along with the
 * rest of the legacy path.
 */
export type BackupMode = { migrated: true; retentionHours: number } | { migrated: false; legacyBackupEnabled: boolean };

export function resolveBackupMode(
  featuresEnabled: string[] | null | undefined,
  dataRetentionValue: unknown,
  capDays?: number
): BackupMode {
  const explicit = parseExplicitBackupRetentionHours(dataRetentionValue);
  if (explicit !== undefined) {
    return { migrated: true, retentionHours: explicit };
  }
  // `nobackup` stays a permanent alias for "no archive at all".
  if (hasNoBackupFlag(featuresEnabled)) {
    return { migrated: true, retentionHours: 0 };
  }
  return { migrated: true, retentionHours: defaultBackupRetentionHours(capDays) };
}

/**
 * The explicit `backupRetentionHours` of a data-retention row, or `undefined`
 * when the row has none (or a malformed one). Only plain non-negative numbers
 * and plain-decimal strings count. Number() would coerce booleans (true -> 1),
 * arrays, and whitespace (" " -> 0 — i.e. "drain everything"); a malformed row
 * must never flip a workspace, least of all to retention 0.
 */
export function parseExplicitBackupRetentionHours(dataRetentionValue: unknown): number | undefined {
  const raw = (dataRetentionValue as { backupRetentionHours?: unknown } | null | undefined)?.backupRetentionHours;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  if (typeof raw === "string" && /^[0-9]+(\.[0-9]+)?$/.test(raw.trim())) {
    const hours = Number(raw.trim());
    // A long digit string coerces to Infinity — still malformed, so fall through.
    if (Number.isFinite(hours)) {
      return hours;
    }
  }
  return undefined;
}

/** Admin-set `nobackup` feature flag — see {@link resolveBackupMode}. */
export function hasNoBackupFlag(featuresEnabled: string[] | null | undefined): boolean {
  return (featuresEnabled ?? []).includes("nobackup");
}

export const dataRetentionNamespace = "data-retention";

/**
 * Backup windows a workspace member can pick in the console (JITSU-202). 0 =
 * no backups. Anything else (e.g. an enterprise contract's 365 days) is set by
 * an admin and shown as a locked "custom" value.
 */
export const BACKUP_RETENTION_PRESET_DAYS = [0, 7, 30, 90] as const;
export type BackupRetentionPresetDays = (typeof BACKUP_RETENTION_PRESET_DAYS)[number];

/** Free / low-tier plans may select at most this many days of backups. */
export const FREE_BACKUP_RETENTION_CAP_DAYS = 7;
/** Paid self-service plans unlock the full preset range. */
export const PAID_BACKUP_RETENTION_CAP_DAYS = 90;

/** "No backups", "7 days", or "36 hours" for a window that isn't whole days. */
export function formatBackupRetention(retentionHours: number): string {
  if (retentionHours <= 0) {
    return "No backups";
  }
  const days = retentionHours / 24;
  if (Number.isInteger(days)) {
    return days === 1 ? "1 day" : `${days} days`;
  }
  return `${retentionHours} hours`;
}

export function isBackupRetentionPreset(days: number): days is BackupRetentionPresetDays {
  return (BACKUP_RETENTION_PRESET_DAYS as readonly number[]).includes(days);
}

/**
 * The longest backup window a plan lets a member select, in days. Plans can
 * set `backupRetentionMaxDays` explicitly (Stripe `plan_data` or a workspace's
 * `customSettings` on ee-api); without it, free plans get the free cap and
 * every other plan — including `$admin` (noRestrictions) — the paid cap. The
 * fallback is what lets existing paid plans work without a Stripe metadata
 * change.
 *
 * An explicit cap never goes below the free cap: the server skips the billing
 * round-trip for requests within the free cap, so a lower cap could not be
 * enforced there anyway. To take backups away from a workspace, set the
 * `nobackup` feature flag instead (it locks the setting outright).
 */
export function getBackupRetentionCapDays(
  billing: { planId?: string; backupRetentionMaxDays?: number } | null | undefined
): number {
  if (typeof billing?.backupRetentionMaxDays === "number" && Number.isFinite(billing.backupRetentionMaxDays)) {
    return Math.max(FREE_BACKUP_RETENTION_CAP_DAYS, billing.backupRetentionMaxDays);
  }
  return !billing || billing.planId === "free" ? FREE_BACKUP_RETENTION_CAP_DAYS : PAID_BACKUP_RETENTION_CAP_DAYS;
}

/** What the console shows for a workspace's backup window — GET backup-retention. */
export const BackupRetentionState = z.object({
  /** Effective retention (explicit row -> `nobackup` -> fleet default). */
  retentionHours: z.number(),
  source: z.enum(["explicit", "nobackup", "default"]),
  /**
   * `nobackup` is an admin decision: backups are off and members cannot turn
   * them back on from the console (an explicit row would otherwise override
   * the flag — see resolveBackupMode).
   */
  locked: z.boolean(),
});
export type BackupRetentionState = z.infer<typeof BackupRetentionState>;

export function describeBackupRetention(
  featuresEnabled: string[] | null | undefined,
  dataRetentionValue: unknown,
  capDays?: number
): BackupRetentionState {
  const locked = hasNoBackupFlag(featuresEnabled);
  const mode = resolveBackupMode(featuresEnabled, dataRetentionValue, capDays);
  const retentionHours = mode.migrated ? mode.retentionHours : 0;
  const source =
    parseExplicitBackupRetentionHours(dataRetentionValue) !== undefined ? "explicit" : locked ? "nobackup" : "default";
  return { retentionHours, source, locked };
}

/** PUT backup-retention body. */
export const BackupRetentionChange = z.object({
  retentionDays: z.number().int().min(0),
  /** Required when `retentionDays` is 0 — the member confirmed there will be no recovery copy. */
  acknowledgeDataLoss: z.boolean().optional(),
});
export type BackupRetentionChange = z.infer<typeof BackupRetentionChange>;

export type BackupRetentionChangeError = {
  code: "not_preset" | "locked" | "plan_cap" | "ack_required";
  message: string;
};

/**
 * Pure validation shared by the API route (authoritative) and the editor
 * (early feedback). `capDays` is the plan cap from getBackupRetentionCapDays;
 * `locked` is the `nobackup` flag.
 */
export function validateBackupRetentionChange(
  change: BackupRetentionChange,
  ctx: { capDays: number; locked: boolean }
): BackupRetentionChangeError | undefined {
  if (ctx.locked) {
    return {
      code: "locked",
      message: "Backups are turned off for this workspace by Jitsu. Contact support to change that.",
    };
  }
  if (!isBackupRetentionPreset(change.retentionDays)) {
    return {
      code: "not_preset",
      message: `Backup retention must be one of ${BACKUP_RETENTION_PRESET_DAYS.join(", ")} days`,
    };
  }
  if (change.retentionDays > ctx.capDays) {
    return {
      code: "plan_cap",
      message: `Your plan includes up to ${ctx.capDays} days of backups. Upgrade to keep backups for ${change.retentionDays} days.`,
    };
  }
  if (change.retentionDays === 0 && !change.acknowledgeDataLoss) {
    return {
      code: "ack_required",
      message: "Turning backups off requires acknowledging that events cannot be recovered afterwards.",
    };
  }
  return undefined;
}

/** Whether ingest should copy this workspace's events to the backup topic. */
export function isBackupEnabled(
  featuresEnabled: string[] | null | undefined,
  dataRetentionValue: unknown,
  capDays?: number
): boolean {
  const mode = resolveBackupMode(featuresEnabled, dataRetentionValue, capDays);
  return mode.migrated ? mode.retentionHours > 0 : mode.legacyBackupEnabled;
}
