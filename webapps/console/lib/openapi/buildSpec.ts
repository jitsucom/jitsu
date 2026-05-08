import "./setup";
import "./annotations";
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas30";
import { getPublicRoutes } from "./registry";
import {
  AnyDestination,
  ApiKeySchema,
  ConfigEntityBaseSchema,
  DestinationConfigSchema,
  FunctionConfigSchema,
  MiscEntitySchema,
  NotificationChannelSchema,
  ServiceConfigSchema,
  StreamConfigSchema,
  WorkspaceDomainSchema,
  WorkspaceSchema,
  WorkspaceListItemSchema,
  destinationSubtypeSchemas,
} from "./annotations";
import { tagInfos, getTagInfo } from "./tags";

let cached: OpenAPIObject | undefined;

export function buildOpenApiSpec(opts?: { servers?: { url: string; description?: string }[] }): OpenAPIObject {
  if (cached && !opts) return cached;

  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description:
      "API key authentication. Use the format `<keyId>:<secret>`. Generate API keys in the Jitsu console under User Settings → API Keys.",
  });

  // Register named schemas so they appear under components/schemas and operations $ref them.
  registry.register("ConfigEntityBase", ConfigEntityBaseSchema);
  registry.register("ApiKey", ApiKeySchema);
  registry.register("StreamConfig", StreamConfigSchema);
  registry.register("DestinationConfig", DestinationConfigSchema);
  registry.register("FunctionConfig", FunctionConfigSchema);
  registry.register("ServiceConfig", ServiceConfigSchema);
  registry.register("WorkspaceDomain", WorkspaceDomainSchema);
  registry.register("MiscEntity", MiscEntitySchema);
  registry.register("NotificationChannel", NotificationChannelSchema);
  registry.register("Workspace", WorkspaceSchema);
  registry.register("WorkspaceListItem", WorkspaceListItemSchema);
  for (const { name, schema } of Object.values(destinationSubtypeSchemas)) {
    registry.register(name, schema);
  }
  registry.register("AnyDestination", AnyDestination);

  for (const { path, route } of getPublicRoutes()) {
    const fragment = route.toOpenAPISpec({ basePath: path });
    for (const r of fragment.routes) {
      registry.registerPath(r);
    }
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);
  const doc = generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Jitsu API",
      version: "1.0.0",
      description:
        "Jitsu is an open-source data pipeline platform. This API lets you manage workspace configuration objects (destinations, streams, functions, services, etc.) and access workspace metrics. See https://docs.jitsu.com/api for guides.\n\n" +
        "## Authentication\n\n" +
        "Use a bearer token in the format `<keyId>:<secret>`. Generate API keys in the Jitsu console under **User Settings → API Keys**.\n\n" +
        "## Finding your workspace ID\n\n" +
        "Most endpoints require a `workspaceId` path parameter. You can find it in the URL of any workspace page in the Jitsu console — for example `https://use.jitsu.com/<workspaceId>/settings`. " +
        "You can also list all workspaces available to your user with `GET /api/workspace`.",
    },
    servers: opts?.servers ?? [{ url: "https://use.jitsu.com", description: "Jitsu Cloud" }],
    security: [{ bearerAuth: [] }],
    tags: tagInfos.map(t => ({
      name: t.name,
      description: t.description,
      ...(t.externalDocs ? { externalDocs: t.externalDocs } : {}),
    })),
  });

  // Operations were registered with tag slugs (e.g. "destination"). Rewrite to display names
  // ("Destinations") so the renderer matches them to the document-level `tags` array.
  if (doc.paths) {
    for (const pathItem of Object.values(doc.paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      for (const op of Object.values(pathItem as Record<string, any>)) {
        if (op && typeof op === "object" && Array.isArray(op.tags)) {
          op.tags = op.tags.map((slug: string) => getTagInfo(slug)?.name ?? slug);
        }
      }
    }
  }

  if (!opts) cached = doc;
  return doc;
}
