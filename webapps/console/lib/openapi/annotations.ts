import "./setup";
import { z } from "zod";
import {
  ApiKey as ApiKeyOriginal,
  ConfigEntityBase as ConfigEntityBaseOriginal,
  DestinationConfig as DestinationConfigOriginal,
  FunctionConfig as FunctionConfigOriginal,
  MiscEntity as MiscEntityOriginal,
  NotificationChannel as NotificationChannelOriginal,
  ServiceConfig as ServiceConfigOriginal,
  StreamConfig as StreamConfigOriginal,
  WorkspaceDomain as WorkspaceDomainOriginal,
} from "../schema";
import { coreDestinations } from "../schema/destinations";

// `.openapi(refId)` returns a NEW schema instance with metadata attached — it does NOT mutate.
// Capture and re-export so consumers reference the annotated versions and the generator emits $refs.
export const ConfigEntityBaseSchema = ConfigEntityBaseOriginal.openapi("ConfigEntityBase", {
  title: "Config entity base",
  description: "Base fields shared by every workspace configuration object.",
});
export const ApiKeySchema = ApiKeyOriginal.openapi("ApiKey", {
  title: "API key",
  description: "An API key associated with a stream. Use the `plaintext` field on creation; afterwards only `hash`/`hint` are returned.",
});
export const StreamConfigSchema = StreamConfigOriginal.openapi("StreamConfig", {
  title: "Stream",
  description: "An incoming-events stream (formerly known as a source). Holds public/private write keys and the domains allowed to send events.",
});
export const DestinationConfigSchema = DestinationConfigOriginal.openapi("DestinationConfig", {
  title: "Destination (base)",
  description:
    "Base shape shared by every destination type. Concrete subtypes (DestinationPostgres, DestinationClickhouse, etc.) extend this with type-specific credentials.",
});
export const FunctionConfigSchema = FunctionConfigOriginal.openapi("FunctionConfig", {
  title: "Function",
  description: "A user-defined function (UDF). `code` is the published version; `draft` is the in-progress edit.",
});
export const ServiceConfigSchema = ServiceConfigOriginal.openapi("ServiceConfig", {
  title: "Service (connector)",
  description: "An external service polled by a connector (Airbyte protocol). The `package` and `version` reference a connector image.",
});
export const WorkspaceDomainSchema = WorkspaceDomainOriginal.openapi("WorkspaceDomain", {
  title: "Workspace domain",
  description: "A custom domain registered in the workspace (used for ingestion endpoints).",
});
export const MiscEntitySchema = MiscEntityOriginal.openapi("MiscEntity", {
  title: "Miscellaneous entity",
  description: "Catch-all configuration object with a free-form `value`. Used for things like classic event mappings.",
});
export const NotificationChannelSchema = NotificationChannelOriginal.openapi("NotificationChannel", {
  title: "Notification channel",
  description: "Subscription that delivers workspace alerts (sync failures, batch failures, dead-letter events) to email or Slack.",
});

const configObjectSchemas: Record<string, z.ZodTypeAny> = {
  destination: DestinationConfigSchema,
  stream: StreamConfigSchema,
  function: FunctionConfigSchema,
  service: ServiceConfigSchema,
  domain: WorkspaceDomainSchema,
  misc: MiscEntitySchema,
  notification: NotificationChannelSchema,
};

export function getAnnotatedConfigObjectSchema(type: string): z.ZodTypeAny | undefined {
  return configObjectSchemas[type];
}

function pascalCase(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export const destinationSubtypeSchemas: Record<string, { name: string; schema: z.ZodObject<any> }> = {};

for (const d of coreDestinations) {
  const name = `Destination${pascalCase(d.id)}`;
  // Description on the destination type object can be ReactNode; only forward strings.
  const description = typeof d.description === "string" ? d.description : undefined;
  // Use .extend() on the annotated DestinationConfig so the generator emits
  // allOf: [{$ref: DestinationConfig}, {credentials-only props}] — common fields aren't duplicated.
  const schema = DestinationConfigSchema.extend({
    destinationType: z.literal(d.id),
    ...d.credentials.shape,
  }).openapi(name, {
    title: d.title,
    ...(description ? { description } : {}),
  });
  destinationSubtypeSchemas[d.id] = { name, schema };
}

const subtypes = coreDestinations.map(d => destinationSubtypeSchemas[d.id].schema);

export const AnyDestination = (
  subtypes.length >= 2 ? z.discriminatedUnion("destinationType", subtypes as any) : subtypes[0]
).openapi("AnyDestination");
