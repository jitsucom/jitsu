import { createRoute } from "../../../../../lib/api";
import { z } from "zod";
import { BackupRetentionChange, BackupRetentionState } from "../../../../../lib/shared/data-retention";
import { BackupRetentionService } from "../../../../../lib/server/backup-retention-service";

/** Self-serve event-backup retention (JITSU-202) — see BackupRetentionService. */
export default createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceIdOrSlug: z.string() }),
    result: BackupRetentionState,
  })
  .handler(async ({ query: { workspaceIdOrSlug }, user, req }) => {
    return new BackupRetentionService().get(user, workspaceIdOrSlug, { req });
  })
  .PUT({
    auth: true,
    query: z.object({ workspaceIdOrSlug: z.string() }),
    body: BackupRetentionChange,
    result: BackupRetentionState,
  })
  .handler(async ({ query: { workspaceIdOrSlug }, user, body, req }) => {
    return new BackupRetentionService().update(user, workspaceIdOrSlug, body, { req });
  })
  .toNextApiHandler();
