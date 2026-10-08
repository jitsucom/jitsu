import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";
import { ReverseDeliveryStats } from "@jitsu/protocols/reverse-etl-stats";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import {
  MetaAudienceOptions,
  MetaConversionOptions,
  MetaId,
  metaAudienceStateStream,
  metaDestinationId,
} from "@jitsu/destination-functions/src/functions/facebook/reverse-meta";
import { readMetaResults, type MetaResultTarget } from "@jitsu/destination-functions/src/functions/facebook/results";
import type { MetaDestinationResults } from "@jitsu/destination-functions/src/functions/facebook/results-meta";
import type { MetaFetch } from "@jitsu/destination-functions/src/functions/facebook/client";
import { ApiError } from "../shared/errors";

/** Reporting reads stored scope and target evidence, including paused syncs. No artifact payloads or state writes. */
export async function reverseMetaResults(
  prisma: PrismaClient,
  workspaceId: string,
  syncId: string,
  request: MetaFetch = fetch
): Promise<MetaDestinationResults | null> {
  const link = await prisma.configurationObjectLink.findFirst({
    where: { id: syncId, workspaceId, type: "reverse-sync", deleted: false },
    include: { to: true, workspace: true },
  });
  if (
    !link ||
    link.workspace.deleted ||
    link.to.deleted ||
    link.to.workspaceId !== workspaceId ||
    link.to.type !== "destination"
  )
    throw new ApiError("Reverse sync not found in this workspace", { status: 404 });
  const config = link.to.config as Record<string, unknown>;
  if (config.destinationType !== metaDestinationId) return null;
  const unavailable = (
    reason: "no-target" | "state-mismatch" | "unsupported",
    message: string
  ): MetaDestinationResults => ({ kind: "unavailable", observedAt: new Date().toISOString(), reason, message });
  const options = ReverseSyncOptions.parse(link.data);
  let target: MetaResultTarget;
  if (options.stream === "conversions") {
    target = { stream: "conversions", pixelId: MetaConversionOptions.parse(options.streamOptions).pixelId };
  } else if (options.stream === "audience") {
    const settings = MetaAudienceOptions.parse(options.streamOptions);
    let audienceId: string;
    let ownershipMarker: string | undefined;
    if (settings.audience.kind === "existing") audienceId = settings.audience.audienceId;
    else {
      const state = await prisma.source_state.findUnique({
        where: { sync_id_stream: { sync_id: syncId, stream: metaAudienceStateStream } },
      });
      if (!state)
        return unavailable(
          "no-target",
          "The managed audience has not been created yet. Results become available after the first run creates it."
        );
      const saved = z
        .object({
          version: z.literal(1),
          binding: z.string(),
          marker: z.string().regex(/^jitsu-retl-[a-f0-9]{64}$/),
          phase: z.enum(["prepared", "submitting", "ready"]),
          audienceId: MetaId.optional(),
        })
        .safeParse(state.state);
      if (
        !saved.success ||
        saved.data.binding !== contentHash({ workspace: workspaceId, sync: syncId, destination: link.toId, settings })
      )
        return unavailable(
          "state-mismatch",
          "The saved audience does not match this sync's settings. Preserve its state and reconcile the target before reading results."
        );
      if (saved.data.phase !== "ready" || !saved.data.audienceId)
        return unavailable(
          "no-target",
          "Audience creation is not yet confirmed. Results will be available once the runner resolves the saved creation request; do not reset its state."
        );
      audienceId = saved.data.audienceId;
      ownershipMarker = saved.data.marker;
    }
    target = {
      stream: "audience",
      audienceId,
      accountId: settings.accountId,
      valueBased: settings.valueBased,
      managed: settings.audience.kind === "managed",
      ownershipMarker,
    };
    if (settings.audience.kind === "managed" && options.mode === "mirror" && settings.exclusiveManagementConfirmed) {
      const latest = await prisma.source_task.findFirst({
        where: { sync_id: syncId, package: "jitsu/retl-runner" },
        orderBy: [{ started_at: "desc" }, { task_id: "desc" }],
        select: { status: true, metrics: true },
      });
      const stats = ReverseDeliveryStats.safeParse(
        (latest?.metrics as Record<string, unknown> | null)?.reverseDelivery
      );
      if (
        latest &&
        ["SUCCESS", "COMPLETE"].includes(latest.status) &&
        stats.success &&
        stats.data.snapshot &&
        (await prisma.reverse_sync_control.findFirst({
          where: { workspace_id: workspaceId, sync_id: syncId, run_id: stats.data.runId, phase: "complete" },
          select: { run_id: true },
        }))
      )
        target.snapshot = { ...stats.data.snapshot, observedAt: stats.data.observedAt };
    }
  } else return unavailable("unsupported", "This Meta stream does not support result reporting.");
  return readMetaResults(config, target, request);
}
