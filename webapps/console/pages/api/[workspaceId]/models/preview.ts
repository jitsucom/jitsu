import { z } from "zod";
import { PreviewRequest, PreviewResult } from "@jitsu/warehouse-query/src/schema";
import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseEtlService } from "../../../../lib/server/reverse-etl-service";

export const route = createRoute()
  .POST({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    body: PreviewRequest,
    result: PreviewResult,
    summary: "Preview a Reverse ETL model",
    tags: ["model"],
  })
  .handler(async ({ user, query: { workspaceId }, body, res }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", cancel);
    try {
      return await new ReverseEtlService(db.prisma()).preview(user, workspaceId, body, controller.signal);
    } finally {
      clearTimeout(timeout);
      res.off("close", cancel);
    }
  });

export default route.toNextApiHandler();
