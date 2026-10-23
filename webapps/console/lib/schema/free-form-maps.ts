import { ZodTypeAny } from "zod";
import { coreDestinationsMap } from "./destinations";
import { db } from "../server/db";
import { getServerLog } from "../server/log";
import get from "lodash/get";
import set from "lodash/set";
import has from "lodash/has";
import isEmpty from "lodash/isEmpty";

const log = getServerLog("free-form-maps");

/**
 * Config updates are a merge (`deepMerge`), so a PUT that omits a field keeps the
 * stored value — that's what makes partial updates work (the write-key auto-save,
 * `jitsu-cli config update --field.x=y`, the MCP `update_resource` tool) and what
 * preserves masked secrets the client never sends back.
 *
 * Merging breaks down for *free-form maps* — fields whose key set is itself user
 * data, e.g. a warehouse's `parameters`. deepMerge only adds or overwrites keys,
 * so a removed key survives and the user cannot clear it (JITSU-160). For those
 * fields the map has to be replaced wholesale.
 *
 * A field counts as free-form when its schema leaves the key set open:
 *   - zod (destinations): `z.object({...}).catchall(...)`, `.passthrough()`, or
 *     `z.record(...)` — note Mysql's `parameters` declares `tls` *and* a catchall,
 *     so the presence of a catchall is the signal, not an empty shape.
 *   - JSON Schema (services): `type: "object"` whose `additionalProperties` is a
 *     *schema*, or is `true` with no `properties` declared beside it. A bare
 *     `additionalProperties: true` on a declared object does not count — Airbyte uses
 *     it there as a laxness flag (see `isOpenMapSchema`).
 *
 * Replacement is still keyed off the patch: a path absent from the patch is left
 * alone, so partial updates keep working. Only a map the caller actually sent —
 * including an empty `{}` — replaces what's stored.
 */

/** Strip .optional() / .default() / .nullable() / .describe() wrappers. */
function unwrap(schema: ZodTypeAny | undefined): any {
  let s: any = schema;
  // Bounded to avoid spinning on an unexpected self-referential schema.
  for (let i = 0; s && i < 20; i++) {
    const def = s._def;
    if (!def) {
      return s;
    }
    if (def.innerType) {
      s = def.innerType; // ZodOptional / ZodDefault / ZodNullable / ZodBranded
    } else if (def.schema) {
      s = def.schema; // ZodEffects
    } else {
      return s;
    }
  }
  return s;
}

function isFreeFormMap(schema: any): boolean {
  const def = schema?._def;
  if (!def) {
    return false;
  }
  if (def.typeName === "ZodRecord") {
    return true;
  }
  if (def.typeName !== "ZodObject") {
    return false;
  }
  return def.unknownKeys === "passthrough" || (!!def.catchall && def.catchall._def?.typeName !== "ZodNever");
}

/**
 * Walk a zod object schema and return dot-paths of every free-form map field.
 * Recurses into declared sub-objects so a nested `parameters` is still found.
 */
function collectZodFreeFormPaths(schema: ZodTypeAny | undefined, basePath = "", depth = 0): string[] {
  const node = unwrap(schema);
  if (depth > 10 || node?._def?.typeName !== "ZodObject") {
    return [];
  }
  const shape = typeof node._def.shape === "function" ? node._def.shape() : node._def.shape;
  if (!shape) {
    return [];
  }
  const paths: string[] = [];
  for (const [key, field] of Object.entries<ZodTypeAny>(shape)) {
    const path = basePath ? `${basePath}.${key}` : key;
    const inner = unwrap(field);
    if (isFreeFormMap(inner)) {
      // The map itself is the unit of edit — don't descend into it.
      paths.push(path);
    } else {
      paths.push(...collectZodFreeFormPaths(inner, path, depth + 1));
    }
  }
  return paths;
}

/**
 * Free-form map paths for a destination. Destination credentials are merged into
 * the config object at the top level (see `narrowSchema`), so paths are relative
 * to the config object itself — `parameters`, not `credentials.parameters`.
 */
export function getDestinationFreeFormPaths(destinationType: string): string[] {
  const destination = coreDestinationsMap[destinationType];
  if (!destination?.credentials) {
    return [];
  }
  try {
    return collectZodFreeFormPaths(destination.credentials);
  } catch (error) {
    log.atError().withCause(error).log(`Failed to collect free-form paths for destination ${destinationType}`);
    return [];
  }
}

/**
 * Is this JSON Schema node a free-form map, i.e. is its key set genuinely user data?
 *
 * A *schema-valued* `additionalProperties` always counts — it describes the values of keys
 * the spec cannot name, which is exactly an open map.
 *
 * A bare `additionalProperties: true` only counts when nothing is declared alongside it.
 * On its own it is the "arbitrary key/value bag" idiom; next to `properties` it is merely a
 * laxness flag, which Airbyte specs use routinely on ordinary declared objects (e.g.
 * source-postgres `ssl_mode`, whose every branch declares `properties` *and*
 * `additionalProperties: true`). Reading the latter as a map would replace the object
 * wholesale on a partial update and drop the untouched keys — including stored secrets,
 * which `removeMaskedValues` strips out of the patch before the merge.
 */
function isOpenMapSchema(schema: any): boolean {
  const ap = schema?.additionalProperties;
  if (typeof ap === "object" && ap !== null) {
    return true;
  }
  return ap === true && isEmpty(schema?.properties);
}

/**
 * Walk an Airbyte `connectionSpecification` and return `credentials.`-prefixed
 * paths of every free-form map. Mirrors `getServiceSecretPaths`, including the
 * oneOf/anyOf handling. Pure — exported so it's unit-testable without a DB.
 */
export function collectJsonSchemaFreeFormPaths(connectionSpec: any): string[] {
  if (!connectionSpec?.properties) {
    return [];
  }
  const paths: string[] = [];
  const walk = (properties: any, basePath = "", depth = 0) => {
    if (depth > 10) {
      return;
    }
    Object.entries(properties).forEach(([key, schema]: [string, any]) => {
      const path = basePath ? `${basePath}.${key}` : key;
      if (schema?.type === "object" && isOpenMapSchema(schema)) {
        // Open key set — replace rather than merge (see `isOpenMapSchema`).
        paths.push(`credentials.${path}`);
        return;
      }
      if (schema?.type === "object" && schema.properties) {
        walk(schema.properties, path, depth + 1);
      }
      const branches = schema?.oneOf || schema?.anyOf;
      if (branches) {
        branches.forEach((branch: any) => branch?.properties && walk(branch.properties, path, depth + 1));
      }
    });
  };
  walk(connectionSpec.properties);
  return [...new Set(paths)];
}

/**
 * Free-form map paths for a service, read from the connector's declarative
 * (Airbyte JSON Schema) spec.
 */
export async function getServiceFreeFormPaths(packageName: string, version: string): Promise<string[]> {
  try {
    const sourceSpec = await db.prisma().source_spec.findUnique({
      where: { package_version: { package: packageName, version } },
    });
    return collectJsonSchemaFreeFormPaths((sourceSpec?.specs as any)?.connectionSpecification);
  } catch (error) {
    log.atError().withCause(error).log(`Failed to collect free-form paths for service ${packageName}@${version}`);
    return [];
  }
}

/**
 * Overwrite each free-form map that the patch actually supplied. `merged` is the
 * deepMerge result (deepMerge mutates and returns `original`), so this restores
 * removals the merge swallowed.
 */
export function replaceFreeFormMaps<T>(merged: T, patch: any, freeFormPaths: string[]): T {
  for (const path of freeFormPaths) {
    if (has(patch, path)) {
      set(merged as any, path, get(patch, path));
    }
  }
  return merged;
}
