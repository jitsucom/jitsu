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
   * the default. ADMIN-SET ONLY — the workspace-options POST endpoint strips
   * it from member requests. See resolveBackupMode().
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
 * Fleet default retention (90 days), applied to any workspace without an
 * explicit `backupRetentionHours` — see {@link resolveBackupMode}.
 */
export const DEFAULT_BACKUP_RETENTION_HOURS = 90 * 24;

/**
 * Resolves a workspace's event-archive retention. Every workspace archives to
 * GCS with an enforced retention; there is no unmigrated/legacy-S3 mode left
 * (the fleet backfill completed 2026-08-13, and the default now covers
 * anything without an explicit row — including newly created workspaces).
 *
 * Order: explicit `backupRetentionHours` -> `nobackup` (permanent alias for
 * 0) -> DEFAULT_BACKUP_RETENTION_HOURS. `0` = no archive at all; it drains.
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
  dataRetentionValue: unknown
): BackupMode {
  const raw = (dataRetentionValue as { backupRetentionHours?: unknown } | null | undefined)?.backupRetentionHours;
  // Only plain non-negative numbers and plain-decimal strings migrate.
  // Number() would coerce booleans (true -> 1), arrays, and whitespace
  // (" " -> 0 — i.e. "drain everything"); a malformed row must never flip a
  // workspace, least of all to retention 0.
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return { migrated: true, retentionHours: raw };
  }
  if (typeof raw === "string" && /^[0-9]+(\.[0-9]+)?$/.test(raw.trim())) {
    const hours = Number(raw.trim());
    // A long digit string coerces to Infinity — still malformed, so fall through.
    if (Number.isFinite(hours)) {
      return { migrated: true, retentionHours: hours };
    }
  }
  // `nobackup` stays a permanent alias for "no archive at all".
  if ((featuresEnabled ?? []).includes("nobackup")) {
    return { migrated: true, retentionHours: 0 };
  }
  return { migrated: true, retentionHours: DEFAULT_BACKUP_RETENTION_HOURS };
}

/** Whether ingest should copy this workspace's events to the backup topic. */
export function isBackupEnabled(featuresEnabled: string[] | null | undefined, dataRetentionValue: unknown): boolean {
  const mode = resolveBackupMode(featuresEnabled, dataRetentionValue);
  return mode.migrated ? mode.retentionHours > 0 : mode.legacyBackupEnabled;
}
