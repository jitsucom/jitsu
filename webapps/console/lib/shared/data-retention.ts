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
   * Event-archive retention in hours; 0 disables archiving entirely (and
   * drains the existing archive). Absent → the `nobackup` feature flag (a
   * permanent alias for 0), then the 90-day default. Admin-set for now; see
   * resolveRetentionHours().
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
 * Intended default retention (90 days) for the eventual fleet-wide backfill.
 * NOT applied implicitly: a workspace without an explicit setting is
 * "unmigrated" and keeps today's S3 behavior — see {@link resolveBackupMode}.
 */
export const DEFAULT_BACKUP_RETENTION_HOURS = 90 * 24;

/**
 * Migration gate (per-workspace): an explicit `backupRetentionHours` in the
 * `WorkspaceOptions(namespace='data-retention')` JSON migrates the workspace
 * to the GCS event archive with enforced retention (`0` = no archive at all;
 * the existing archive drains). Without it the workspace is UNMIGRATED and
 * keeps today's behavior: S3 archive, no retention enforcement, `nobackup`
 * feature flag as the only off switch.
 *
 * The ee billing server mirrors this logic (`lib/data-retention.ts` in
 * jitsu-cloud-billing) to emit bulker backup connections and manage bucket
 * lifecycle rules — keep the two in sync. The raw value is parsed loosely
 * (numbers or numeric strings) because rows are written through
 * `z.coerce.number()` and may predate this field; garbage or negative values
 * are treated as unset, i.e. unmigrated.
 */
export type BackupMode = { migrated: true; retentionHours: number } | { migrated: false; legacyBackupEnabled: boolean };

export function resolveBackupMode(
  featuresEnabled: string[] | null | undefined,
  dataRetentionValue: unknown
): BackupMode {
  const raw = (dataRetentionValue as { backupRetentionHours?: unknown } | null | undefined)?.backupRetentionHours;
  if (raw !== undefined && raw !== null && raw !== "") {
    const hours = Number(raw);
    if (Number.isFinite(hours) && hours >= 0) {
      return { migrated: true, retentionHours: hours };
    }
  }
  return { migrated: false, legacyBackupEnabled: !(featuresEnabled ?? []).includes("nobackup") };
}

/** Whether ingest should copy this workspace's events to the backup topic. */
export function isBackupEnabled(featuresEnabled: string[] | null | undefined, dataRetentionValue: unknown): boolean {
  const mode = resolveBackupMode(featuresEnabled, dataRetentionValue);
  return mode.migrated ? mode.retentionHours > 0 : mode.legacyBackupEnabled;
}
