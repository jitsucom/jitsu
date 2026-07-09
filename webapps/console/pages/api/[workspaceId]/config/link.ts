import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ConfigObjectsService } from "../../../../lib/server/config-objects-service";

const linkBodySchema = z.object({
  id: z.string().optional(),
  data: z.any().optional(),
  toId: z.string(),
  fromId: z.string(),
  type: z.string().optional(),
});

const linkUpsertResult = z.object({ id: z.string(), created: z.boolean() });

let service: ConfigObjectsService | undefined;
const configObjects = () => (service ??= new ConfigObjectsService({ prisma: db.prisma() }));

const upsertHandler = async (ctx: any) => {
  const {
    body,
    user,
    query: { workspaceId, runSync, strict },
    req,
  } = ctx;
  return await configObjects().upsertLink(user, workspaceId, body, {
    strict: strict === "true",
    runSync: runSync === "true" || runSync === "1",
    req,
  });
};

const upsertOptions = {
  auth: true as const,
  query: z.object({
    workspaceId: z.string(),
    runSync: z.string().optional(),
    strict: z.string().optional(),
  }),
  body: linkBodySchema,
  result: linkUpsertResult,
  tags: ["link"],
};

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    summary: "List connections",
    tags: ["link"],
  })
  .handler(async ({ user, query: { workspaceId } }) => {
    const links = await configObjects().listLinks(user, workspaceId);
    return { links };
  })
  .POST({ ...upsertOptions, summary: "Create connection" })
  .handler(upsertHandler)
  .PUT({ ...upsertOptions, summary: "Update connection" })
  .handler(upsertHandler)
  .DELETE({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      type: z.string().optional(),
      id: z.string().optional(),
      fromId: z.string().optional(),
      toId: z.string().optional(),
    }),
    summary: "Delete connection",
    tags: ["link"],
  })
  .handler(async ({ req, user, query: { workspaceId, fromId, toId, id } }) => {
    return await configObjects().deleteLink(user, workspaceId, { id, fromId, toId }, { req });
  });

export default route.toNextApiHandler();
