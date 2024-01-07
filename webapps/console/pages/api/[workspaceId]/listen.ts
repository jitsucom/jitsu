import { z } from "zod";
import { createRoute, verifyAccess } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { ApiError } from "../../../lib/shared/errors";
import { NextApiResponse } from "next";
import { requireDefined } from "juava";

const lastUpdatedQuery = `
    select
        greatest(
                (select max("updatedAt")::timestamp with time zone from newjitsu."ConfigurationObject" where "workspaceId" = $1),
                (select max("updatedAt")::timestamp with time zone from newjitsu."ConfigurationObjectLink" where "workspaceId" = $1),
                (select max("updatedAt")::timestamp with time zone from newjitsu."Workspace" where id = $1)
        ) as "last_updated"
`;

async function getLastModification(workspaceId: string): Promise<Date> {
  return requireDefined(
    ((await db.prisma().$queryRawUnsafe(lastUpdatedQuery, workspaceId)) as any)?.[0]?.last_updated,
    `Can't get last modification date`
  ) as Date;
}

function createResponse(res: NextApiResponse, modifiedAt: Date, ifModifiedSince: Date) {
  res.setHeader("Last-Modified", modifiedAt.toUTCString());
  if (modifiedAt.getTime() < ifModifiedSince.getTime()) {
    res.status(304);
    return undefined;
    // I wish we could return an informational response here, but 304 status won't allow to return a body
  } else {
    return {
      modified: true,
      lastModified: modifiedAt.toISOString(),
      ifModifiedSince: ifModifiedSince.toISOString(),
      now: new Date().toISOString(),
    };
  }
}

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      maxWaitMs: z.coerce.number().optional().default(10_000),
      ifModifiedSince: z.coerce.date().optional(),
    }),
    result: z
      .object({
        modified: z.boolean(),
        lastModified: z.string(),
        ifModifiedSince: z.string(),
        now: z.string(),
      })
      .optional(),
  })
  .handler(async ({ req, res, user, query }) => {
    const ifModifiedSinceVal = req.headers["if-modified-since"];
    if (!ifModifiedSinceVal && !query.ifModifiedSince) {
      throw new ApiError("Missing If-Modified-Since header", { status: 400 });
    }
    const ifModifiedSince = query.ifModifiedSince || new Date(ifModifiedSinceVal!);

    await verifyAccess(user, query.workspaceId);
    let modifiedAt = await getLastModification(query.workspaceId);
    if (modifiedAt.getTime() >= ifModifiedSince.getTime()) {
      //modified, send response right away
      return createResponse(res, modifiedAt, ifModifiedSince);
    }
    //emulate long polling
    await new Promise(resolve => setTimeout(resolve, query.maxWaitMs));
    modifiedAt = await getLastModification(query.workspaceId);
    return createResponse(res, modifiedAt, ifModifiedSince);
  })
  .toNextApiHandler();
