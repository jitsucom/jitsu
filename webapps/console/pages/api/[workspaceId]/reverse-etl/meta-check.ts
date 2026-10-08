import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { reverseMetaCheck } from "../../../../lib/server/reverse-meta-options";

export const route = createRoute()
  .POST({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    body: z
      .object({
        destinationId: z.string().min(1),
        stream: z.enum(["audience", "conversions"]),
        streamOptions: z.record(z.unknown()),
      })
      .strict(),
    result: z.object({ name: z.string(), message: z.string() }),
  })
  .handler(async ({ user, query, body, res }) => {
    await verifyAccessWithRole(user, query.workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    return reverseMetaCheck(db.prisma(), query.workspaceId, body.destinationId, body.stream, body.streamOptions);
  });
export default route.toNextApiHandler();
