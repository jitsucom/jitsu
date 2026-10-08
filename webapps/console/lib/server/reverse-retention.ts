import type { Prisma, PrismaClient } from "@prisma/client";
import { getLog, rpc } from "juava";
import { dataRetentionNamespace, resolveBackupMode } from "../shared/data-retention";
import { getEeServerConnection, isEEAvailable, serviceTokenHeaders } from "./ee";

/**
 * Retention of the stored rows of a webhook Reverse ETL sync (JITSU-242, WP7).
 *
 * The runner keeps the rows of each batch in a per-workspace bucket whose lifecycle rule ee-api keeps equal to the
 * workspace's storage duration (`backupRetentionHours`). Console tells the runner which bucket through the optional
 * `retention` field of the run configuration, only for webhook syncs. Other providers, including the Google syncs
 * that run today, are untouched. The field is outside the sync's revision hash.
 */
const log = getLog("reverse-retention");

type OptionsDb = Pick<Prisma.TransactionClient, "workspaceOptions">;

export const WEBHOOK_RETENTION_ZERO_MESSAGE =
  "Webhook syncs need stored copies of the rows for recovery, but this workspace's storage duration is 0 days. " +
  "Choose 7 days or more in the workspace's data retention settings.";

export function isWebhookDestination(destination: Record<string, unknown>): boolean {
  return destination.destinationType === "webhook";
}

/** Same name ee-api creates (`gcsRetlBucketName` in jitsu-cloud-billing) and the runner's schema accepts. */
export function retlBucketName(workspaceId: string): string {
  return `jitsu-retl-${workspaceId}`;
}

/**
 * The retention block of the run configuration, or undefined when the destination is not a webhook or ee-api is not
 * available (self-hosted: nothing creates the buckets, and the runner would refuse a bucket that does not exist).
 */
export function retentionConfig(
  workspaceId: string,
  destination: Record<string, unknown>
): { bucket: string } | undefined {
  if (!isWebhookDestination(destination) || !isEEAvailable()) return undefined;
  return { bucket: retlBucketName(workspaceId) };
}

/** The workspace's resolved storage duration in hours, resolved exactly as ee-api resolves it (freshest row wins). */
export async function workspaceRetentionHours(
  db: OptionsDb,
  workspaceId: string,
  featuresEnabled: string[]
): Promise<number> {
  const rows = await db.workspaceOptions.findMany({
    where: { workspaceId, namespace: dataRetentionNamespace },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 1,
  });
  const mode = resolveBackupMode(featuresEnabled, rows[0]?.value);
  return mode.migrated ? mode.retentionHours : 0;
}

/**
 * Message when a webhook run must not start because nothing could be stored for recovery, else undefined. Only for new
 * runs: the desired-state export never refuses (one workspace must not break the export of every sync), and neither
 * does a recovery of a saved run.
 */
export async function webhookRetentionRefusal(
  db: OptionsDb,
  workspaceId: string,
  featuresEnabled: string[],
  destination: Record<string, unknown>
): Promise<string | undefined> {
  if (!retentionConfig(workspaceId, destination)) return undefined;
  return (await workspaceRetentionHours(db, workspaceId, featuresEnabled)) > 0
    ? undefined
    : WEBHOOK_RETENTION_ZERO_MESSAGE;
}

/**
 * Ask ee-api to create or update the workspace's retention bucket now. Best-effort, like `applyRetentionNowViaEe`: the
 * hourly ee-api pass is the backstop, and a run before the bucket exists fails closed with its own message.
 */
export async function provisionRetlBucketViaEe(workspaceId: string): Promise<void> {
  if (!isEEAvailable()) return;
  try {
    await rpc(`${getEeServerConnection().host}api/retl-init?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...serviceTokenHeaders() },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    log.atWarn().withCause(e).log(`Failed to provision the Reverse ETL retention bucket of workspace ${workspaceId}`);
  }
}

/** After a sync is saved: provision the bucket when its destination is a webhook. Never throws. */
export async function provisionRetlBucketForSync(
  prisma: Pick<PrismaClient, "configurationObjectLink">,
  workspaceId: string,
  syncId: string
): Promise<void> {
  try {
    const link = await prisma.configurationObjectLink.findFirst({
      where: { id: syncId, workspaceId, type: "reverse-sync", deleted: false },
      include: { to: true },
    });
    if (link && isWebhookDestination(link.to.config as Record<string, unknown>)) {
      await provisionRetlBucketViaEe(workspaceId);
    }
  } catch (e) {
    log.atWarn().withCause(e).log(`Could not check sync ${syncId} for retention provisioning`);
  }
}
