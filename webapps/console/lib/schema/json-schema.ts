import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import { getConfigObjectType, getConfigObjectTypeNonStrict } from "./config-objects";
import { getCoreDestinationTypeNonStrict } from "./destinations";
import { ApiError } from "../shared/errors";
import { BaseLinkType, SyncOptionsType } from "./index";

/**
 * JSON Schema for a config resource, suitable for guiding create/update payloads.
 *
 * Shared by the public `/api/schema/[...type]` route and the MCP `get_resource_schema`
 * tool so both describe resources identically.
 *
 * - `type` is a config-object type (destination, stream, function, …) or `link`/`connection`.
 * - `subType` narrows the schema: a destination/service subtype (e.g. `postgres`), or
 *   for links the connection kind — `sync` (service→destination) or a destination type
 *   (push connection options for that destination).
 */
export function getResourceJsonSchema(type: string, subType?: string): any {
  if (!type) {
    return {};
  }
  if (type === "link" || type === "connection") {
    if (subType) {
      if (subType === "sync") {
        // Pin `type: "sync"` so a schema-following payload isn't treated as a push link
        // (upsertLink defaults a missing `type` to "push").
        return zodToJsonSchema(BaseLinkType.merge(z.object({ type: z.literal("sync"), data: SyncOptionsType })));
      }
      const destinationType = getCoreDestinationTypeNonStrict(subType);
      if (!destinationType) {
        // The public /api/schema route feeds arbitrary crawler input here — an
        // unknown destination type is the caller's mistake, not a server error.
        throw new ApiError(`Unknown destination type '${subType}'`, { status: 404 });
      }
      return zodToJsonSchema(
        BaseLinkType.merge(z.object({ type: z.literal("push"), data: destinationType.connectionOptions }))
      );
    }
    return zodToJsonSchema(BaseLinkType.merge(z.object({ data: z.any() })));
  }
  if (!getConfigObjectTypeNonStrict(type)) {
    throw new ApiError(`Unknown resource type '${type}'`, { status: 404 });
  }
  if (subType && type === "destination" && !getCoreDestinationTypeNonStrict(subType)) {
    throw new ApiError(`Unknown destination type '${subType}'`, { status: 404 });
  }
  const objectType = getConfigObjectType(type);
  const zodType = subType
    ? objectType.narrowSchema({ destinationType: subType }, objectType.schema)
    : objectType.schema;
  return zodToJsonSchema(zodType);
}
