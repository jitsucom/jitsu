import { z } from "zod";
import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";

export default createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string(), since: z.date(), maxWaitMs: z.coerce.number().optional().default(5000) }),
    result: z.object({
      modified: z.boolean(),
      lastModified: z.string(),
      now: z.string(),
    }),
  })
  .handler(async ({ query: { workspaceId, since, maxWaitMs } }) => {
    await new Promise(resolve => setTimeout(resolve, maxWaitMs));
    const max = Math.max(
      ...(await Promise.all([
        db
          .pgPool()
          .query(`select max("updatedAt")::timestamp with time zone as max from newjitsu."ConfigurationObject" where "workspaceId" = $1`, [workspaceId])
          .then(({ rows }) => rows?.[0]?.max || 0),
        db
          .pgPool()
          .query(`select max("updatedAt")::timestamp with time zone as max from newjitsu."ConfigurationObjectLink" where "workspaceId" = $1`, [
            workspaceId,
          ])
          .then(({ rows }) => rows?.[0]?.max || 0),
        db
          .pgPool()
          .query(`select max("updatedAt")::timestamp with time zone as max from newjitsu."Workspace" where id = $1`, [workspaceId])
          .then(({ rows }) => rows?.[0]?.max || 0),
      ]))
    );
    const modifiedAt = new Date(max);
    const sinceTimestamp = since.getTime();
    const modifiedAtTimestamp = modifiedAt.getTime();
    return {
      modified: sinceTimestamp < modifiedAtTimestamp,
      lastModified: modifiedAt.toISOString(),
      now: new Date().toISOString(),
    };
  })
  .toNextApiHandler();
