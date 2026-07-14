import { createRoute } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { getAllConfigObjectTypeNames, getConfigObjectType } from "../../../../../lib/schema/config-objects";
import { AnyDestination, getAnnotatedConfigObjectSchema } from "../../../../../lib/openapi/annotations";
import { ConfigObjectsService } from "../../../../../lib/server/config-objects-service";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

// Spec-visible types — the runtime still accepts every type from getAllConfigObjectTypeNames(),
// but `misc` is an internal catch-all that we don't document publicly.
const publicTypeNames = getAllConfigObjectTypeNames().filter(t => t !== "misc");
const pluralType = (t: string) => `${t}s`;

let service: ConfigObjectsService | undefined;
const configObjects = () => (service ??= new ConfigObjectsService({ prisma: db.prisma() }));

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string(), type: z.string() }),
    result: z.object({ objects: z.array(z.any()) }),
    summary: "List configuration objects",
    tags: ["config"],
    expand: {
      param: "type",
      values: publicTypeNames,
      forValue: type => ({
        summary: `List ${pluralType(type)}`,
        tags: [type],
        result: z.object({
          objects: z.array(
            type === "destination"
              ? AnyDestination
              : getAnnotatedConfigObjectSchema(type) ?? getConfigObjectType(type).schema
          ),
        }),
      }),
    },
  })
  .handler(async ({ user, query: { workspaceId, type } }) => {
    const objects = await configObjects().list(user, workspaceId, type);
    return { objects };
  })
  .POST({
    auth: true,
    query: z.object({ workspaceId: z.string(), type: z.string() }),
    body: z.any(),
    result: z.object({ id: z.string() }),
    summary: "Create a configuration object",
    tags: ["config"],
    expand: {
      param: "type",
      values: publicTypeNames,
      forValue: type => ({
        summary: `Create ${type}`,
        tags: [type],
        body:
          type === "destination"
            ? AnyDestination
            : getAnnotatedConfigObjectSchema(type) ?? getConfigObjectType(type).schema,
      }),
    },
  })
  .handler(async ({ req, body, user, query: { workspaceId, type } }) => {
    return await configObjects().create(user, workspaceId, type, body, { req });
  });

export default route.toNextApiHandler();
