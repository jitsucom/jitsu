import { getServerEnv } from "./serverEnv";

const OVERRIDE_ON = "cronjobs=true";
const OVERRIDE_OFF = "cronjobs=false";

// TEMPORARY: syncs created or updated on or after this UTC date auto-opt-in
// to the autonomous CronJob path. Older syncs continue to ride the legacy
// Cloud Scheduler path (their existing GCS jobs keep firing) until they are
// explicitly migrated via the workspace-level featuresEnabled override or
// the legacy scheduler is fully retired. Cutoff is fixed (not "now - 1d")
// so the gate is deterministic across console pods and over time.
const CRONJOB_AGE_CUTOFF = new Date("2026-05-18T00:00:00Z");

export type WorkspaceFeatures = {
  featuresEnabled?: string[] | null;
};

export type SyncTimestamps = {
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

function toDate(v: Date | string | null | undefined): Date | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Whether the autonomous K8s CronJob path is used for a given sync.
 *
 * Resolution order (first match wins):
 *   1. workspace `featuresEnabled` contains `cronjobs=false` → disabled
 *   2. workspace `featuresEnabled` contains `cronjobs=true`  → enabled
 *   3. sync.createdAt OR sync.updatedAt >= CRONJOB_AGE_CUTOFF → enabled (temp)
 *   4. fall back to global env `SYNCS_CRONJOB_ENABLED`
 *
 * When enabled, the sync is:
 *   - emitted by the admin /export/syncs endpoint (so syncctl reconciles a
 *     K8s CronJob for it), and
 *   - NOT scheduled via the legacy Cloud Scheduler → /sources/run path
 *     (scheduled triggers are ignored to prevent double-execution).
 *
 * Manual user-triggered runs of /sources/run keep working regardless.
 */
export function cronjobsEnabledForSync(workspace: WorkspaceFeatures, sync: SyncTimestamps): boolean {
  const features = workspace.featuresEnabled ?? [];
  if (features.includes(OVERRIDE_OFF)) {
    return false;
  }
  if (features.includes(OVERRIDE_ON)) {
    return true;
  }
  const created = toDate(sync.createdAt);
  const updated = toDate(sync.updatedAt);
  const newest = created && updated ? (created > updated ? created : updated) : created ?? updated;
  if (newest && newest.getTime() >= CRONJOB_AGE_CUTOFF.getTime()) {
    return true;
  }
  return getServerEnv().SYNCS_CRONJOB_ENABLED;
}
