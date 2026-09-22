import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseSyncSetup } from "../../../../lib/reverse-etl";
import { WarehouseColumn } from "@jitsu/warehouse-query/src/schema";
import { validateReverseSetup } from "../../../../lib/server/reverse-syncs";

export const route = createRoute()
  .POST({
    auth: true,
    allowDuringMaintenance: true,
    query: z.object({ workspaceId: z.string() }),
    body: ReverseSyncSetup,
    result: z.object({
      columns: z.array(WarehouseColumn),
      sampleRows: z.number(),
      audienceName: z.string().optional(),
    }),
  })
  .handler(async ({ user, query: { workspaceId }, body, res }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    const { columns, sampleRows, audienceName } = await validateReverseSetup(db.prisma(), workspaceId, body);
    return { columns, sampleRows, audienceName };
  });
export default route.toNextApiHandler();
