import { z } from "zod";
import { WarehouseColumn } from "@jitsu/warehouse-query/src/schema";
import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseEtlService } from "../../../../lib/server/reverse-etl-service";

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string(), modelId: z.string().min(1) }),
    result: z.object({ columns: z.array(WarehouseColumn) }),
    summary: "Inspect a saved Reverse ETL model's columns",
    tags: ["model"],
  })
  .handler(async ({ user, query: { workspaceId, modelId }, res }) => {
    res.setHeader("Cache-Control", "no-store");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", cancel);
    try {
      return await new ReverseEtlService(db.prisma()).columns(user, workspaceId, modelId, controller.signal);
    } finally {
      clearTimeout(timeout);
      res.off("close", cancel);
    }
  });

export default route.toNextApiHandler();
