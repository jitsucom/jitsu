import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import {
  GoogleAudienceSettings,
  GoogleAudienceCredentials,
  GoogleManagedAudience,
} from "@jitsu/destination-functions/src/functions/google-ads/audience/meta";
import {
  GoogleAudienceState,
  LegacyGoogleAudienceState,
  googleAudienceStateBinding,
  googleAudienceStateStream,
} from "@jitsu/destination-functions/src/functions/google-ads/audience/state";
import { ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";

const Intent = z.object({
  phase: z.enum(["prepared", "submitting", "ready"]),
  destinationId: z.string(),
  syncId: z.string(),
  configBinding: z.string(),
  displayName: z.string(),
  integrationCode: z.string(),
  customerId: z.string(),
  audienceId: z.string().optional(),
  membershipDays: z.literal(540),
});
const Setup = z.object({
  syncId: z.string(),
  ready: z.boolean(),
  input: z.object({
    audience: z.object({
      kind: z.enum(["managed", "existing"]),
      displayName: z.string().optional(),
      audienceId: z.string().optional(),
      mirrorStrategy: z.enum(["snapshot-diff", "full-replace"]).optional(),
      exclusiveManagementConfirmed: z.boolean().optional(),
    }),
    customerMatchTermsAccepted: z.literal(true),
  }),
});

/** Explicit operator migration, never called by reads, Save, or runner execution.
 * Pause/drain first. Does not touch Google, delivery controls, checkpoints, artifacts,
 * task history, or target ownership. Ready links keep their delivery JSON verbatim.
 */
export async function migrateReverseSyncSettings(prisma: PrismaClient, workspaceId: string) {
  return prisma.$transaction(
    async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`retl-models:${workspaceId}`},0))`;
      const links = await tx.configurationObjectLink.findMany({
        where: { workspaceId, type: "reverse-sync" },
        include: { to: true },
      });
      let migrated = 0;
      for (const link of links) {
        const setups = await tx.configurationObject.findMany({
          where: { workspaceId, type: "reverse-sync-setup", config: { path: ["syncId"], equals: link.id } },
        });
        const audiences = await tx.configurationObject.findMany({
          where: { workspaceId, type: "reverse-google-audience", config: { path: ["syncId"], equals: link.id } },
        });
        if (!setups.length && !audiences.length) continue;
        const options = ReverseSyncOptions.parse(link.data);
        if (!link.deleted && !options.disabled) throw new Error("Pause all legacy reverse syncs before migration");
        if (await tx.source_task.count({ where: { sync_id: link.id, status: "RUNNING" } }))
          throw new Error("Drain running reverse sync workers before migration");
        if (setups.length > 1 || audiences.length > 1)
          throw new Error("Ambiguous legacy audience/setup evidence; reconcile before migration");
        const setup = setups[0] ? Setup.parse(setups[0].config) : undefined;
        const audience = audiences[0];
        let state: Prisma.InputJsonValue | undefined;
        const ready = options.streamOptions.managedAudienceId !== undefined;
        if (ready) {
          if (!audience || audience.id !== options.streamOptions.managedAudienceId)
            throw new Error("Missing legacy audience evidence; migration stopped");
          const intent = Intent.parse(audience.config);
          if (
            intent.phase !== "ready" ||
            intent.destinationId !== link.toId ||
            intent.syncId !== link.id ||
            intent.audienceId !== options.streamOptions.audienceId
          )
            throw new Error("Legacy audience binding mismatch");
          state = LegacyGoogleAudienceState.parse({
            version: 1,
            workspaceId,
            destinationId: link.toId,
            configBinding: intent.configBinding,
            legacyManaged: GoogleManagedAudience.parse({
              id: audience.id,
              syncId: link.id,
              customerId: intent.customerId,
              audienceId: intent.audienceId,
              integrationCode: intent.integrationCode,
              displayName: intent.displayName,
              membershipDays: intent.membershipDays,
            }),
          });
        } else if (setup && !setup.ready) {
          if (await tx.reverse_sync_control.count({ where: { workspace_id: workspaceId, sync_id: link.id } }))
            throw new Error("Incomplete setup already has delivery state; reconcile before migration");
          const settings = GoogleAudienceSettings.parse({
            audience:
              setup.input.audience.kind === "managed"
                ? { kind: "managed", displayName: setup.input.audience.displayName }
                : { kind: "existing", audienceId: setup.input.audience.audienceId },
            customerMatchTermsAccepted: true,
            ...(setup.input.audience.exclusiveManagementConfirmed ? { exclusiveManagementConfirmed: true } : {}),
            ...(setup.input.audience.mirrorStrategy ? { mirrorStrategy: setup.input.audience.mirrorStrategy } : {}),
          });
          if (audience) {
            const intent = Intent.parse(audience.config);
            if (intent.destinationId !== link.toId || intent.syncId !== link.id)
              throw new Error("Legacy provisioning binding mismatch");
            // Incomplete provisioning must not be rebound to changed credentials.
            if (contentHash(GoogleAudienceCredentials.parse(link.to.config)) !== intent.configBinding)
              throw new Error("Legacy provisioning credentials changed");
            state = GoogleAudienceState.parse({
              version: 1,
              workspaceId,
              binding: googleAudienceStateBinding(workspaceId, link.id, link.toId, link.to.config, settings),
              phase: intent.phase,
              managed: {
                id: audience.id,
                syncId: link.id,
                customerId: intent.customerId,
                integrationCode: intent.integrationCode,
                displayName: intent.displayName,
                membershipDays: intent.membershipDays,
              },
              ...(intent.audienceId ? { audienceId: intent.audienceId } : {}),
            });
          }
          await tx.configurationObjectLink.update({
            where: { id: link.id },
            data: { data: { ...options, streamOptions: settings } as Prisma.InputJsonObject },
          });
        } else if (audience) throw new Error("Unbound legacy audience evidence; migration stopped");
        if (state) {
          const where = { sync_id_stream: { sync_id: link.id, stream: googleAudienceStateStream } };
          const existing = await tx.source_state.findUnique({ where });
          if (existing && contentHash(existing.state) !== contentHash(state))
            throw new Error("Runtime audience state already exists with different evidence");
          if (!existing)
            await tx.source_state.create({ data: { sync_id: link.id, stream: googleAudienceStateStream, state } });
        }
        // Delete only evidence now preserved on this link or in its runtime state, atomically.
        const ids = [...setups, ...audiences].map(row => row.id);
        await tx.configurationObject.deleteMany({ where: { workspaceId, id: { in: ids } } });
        migrated++;
      }
      return { migrated };
    },
    { timeout: 60_000 }
  );
}
