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
export const ConfigEntityBaseSchema = ConfigEntityBaseOriginal.openapi("ConfigEntityBase");
export const ApiKeySchema = ApiKeyOriginal.openapi("ApiKey");
export const StreamConfigSchema = StreamConfigOriginal.openapi("StreamConfig");
export const DestinationConfigSchema = DestinationConfigOriginal.openapi("DestinationConfig");
export const FunctionConfigSchema = FunctionConfigOriginal.openapi("FunctionConfig");
export const ServiceConfigSchema = ServiceConfigOriginal.openapi("ServiceConfig");
export const WorkspaceDomainSchema = WorkspaceDomainOriginal.openapi("WorkspaceDomain");
export const MiscEntitySchema = MiscEntityOriginal.openapi("MiscEntity");
export const NotificationChannelSchema = NotificationChannelOriginal.openapi("NotificationChannel");

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
  // Use .extend() on the annotated DestinationConfig so the generator emits
  // allOf: [{$ref: DestinationConfig}, {credentials-only props}] — common fields aren't duplicated.
  const schema = DestinationConfigSchema.extend({
    destinationType: z.literal(d.id),
    ...d.credentials.shape,
  }).openapi(name);
  destinationSubtypeSchemas[d.id] = { name, schema };
}

const subtypes = coreDestinations.map(d => destinationSubtypeSchemas[d.id].schema);

export const AnyDestination = (
  subtypes.length >= 2 ? z.discriminatedUnion("destinationType", subtypes as any) : subtypes[0]
).openapi("AnyDestination");
