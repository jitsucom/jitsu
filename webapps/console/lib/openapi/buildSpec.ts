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
  destinationSubtypeSchemas,
} from "./annotations";

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
        "Jitsu is an open-source data pipeline platform. This API lets you manage workspace configuration objects (destinations, streams, functions, services, etc.) and access workspace metrics. See https://docs.jitsu.com/api for guides.",
    },
    servers: opts?.servers ?? [{ url: "https://use.jitsu.com", description: "Jitsu Cloud" }],
    security: [{ bearerAuth: [] }],
  });

  if (!opts) cached = doc;
  return doc;
}
