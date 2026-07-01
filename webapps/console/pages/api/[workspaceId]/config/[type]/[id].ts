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

// Spec-visible types — runtime still serves every type from getAllConfigObjectTypeNames(),
// but the `misc` catch-all is omitted from the public OpenAPI document.
const publicTypeNames = getAllConfigObjectTypeNames().filter(t => t !== "misc");

let service: ConfigObjectsService | undefined;
const configObjects = () => (service ??= new ConfigObjectsService({ prisma: db.prisma() }));

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    result: z.any(),
    summary: "Get a configuration object",
    tags: ["config"],
    expand: {
      param: "type",
      values: publicTypeNames,
      forValue: type => ({
        summary: `Get ${type}`,
        tags: [type],
        result:
          type === "destination"
            ? AnyDestination
            : getAnnotatedConfigObjectSchema(type) ?? getConfigObjectType(type).schema,
      }),
    },
  })
  .handler(async ({ user, query: { id, workspaceId, type } }) => {
    return await configObjects().get(user, workspaceId, type, id);
  })
  .PUT({
    auth: true,
    query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    body: z.any(),
    summary: "Update a configuration object",
    tags: ["config"],
    expand: {
      param: "type",
      values: publicTypeNames,
      forValue: type => ({
        summary: `Update ${type}`,
        tags: [type],
        body:
          type === "destination"
            ? AnyDestination
            : getAnnotatedConfigObjectSchema(type) ?? getConfigObjectType(type).schema,
      }),
    },
  })
  .handler(async ({ user, body, query: { id, workspaceId, type } }) => {
    // The service applies `prepareZodObjectForDeserialization` internally.
    await configObjects().update(user, workspaceId, type, id, body);
  })
  .DELETE({
    auth: true,
    query: z.object({
      type: z.string(),
      workspaceId: z.string(),
      id: z.string(),
      strict: z.string().optional(),
      cascade: z.string().optional(),
    }),
    summary: "Delete a configuration object",
    tags: ["config"],
    expand: {
      param: "type",
      values: publicTypeNames,
      forValue: type => ({
        summary: `Delete ${type}`,
        tags: [type],
      }),
    },
  })
  .handler(async ({ user, query: { id, workspaceId, type, strict, cascade } }) => {
    return await configObjects().delete(user, workspaceId, type, id, {
      strict: strict === "true",
      cascade: cascade === "true",
    });
  });

export default route.toNextApiHandler();
