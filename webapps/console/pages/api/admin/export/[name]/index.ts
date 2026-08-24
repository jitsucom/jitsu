import { createRoute, verifyAdmin } from "../../../../../lib/api";
import { db } from "../../../../../lib/server/db";
import { getErrorMessage, getLog, hash as juavaHash, isTruish, requireDefined, rpc } from "juava";
import { z } from "zod";
import { getCoreDestinationTypeNonStrict } from "../../../../../lib/schema/destinations";
import {
  BackupConnectionRow,
  BulkerConnectionRow,
  RotorConnectionRow,
  RotorDestinationRow,
} from "../../../../../lib/schema/export-contracts";
import { getEeConnection, isEEAvailable, serviceTokenHeaders } from "../../../../../lib/server/ee";
import omit from "lodash/omit";
import { NextApiRequest } from "next";
import hash from "object-hash";
import { default as stableHash } from "stable-hash";
import { FunctionsServerDbModel } from "../../../../../prisma/schema";
import { getServerEnv } from "../../../../../lib/server/serverEnv";
import { Prisma } from "@prisma/client";
import { isBackupEnabled } from "../../../../../lib/shared/data-retention";
import {
  observabilityExportsNamespace,
  ObservabilityExportsSettings,
} from "../../../../../lib/shared/observability-exports";

const serverEnv = getServerEnv();
const defaultFunctionsClass = serverEnv.DEFAULT_FUNCTIONS_CLASS;
const defaultClassesPriorities = ["premium", "dedicated", "free"];
const functionsClassesPriorities: Record<string, string[]> = {
  free: ["free", "dedicated", "premium"],
  dedicated: ["dedicated", "premium", "free"],
  premium: ["premium", "dedicated", "free"],
};

type FunctionsServerDbModel = z.infer<typeof FunctionsServerDbModel>;

export const config = {
  api: {
    responseLimit: false,
  },
};

interface Writer {
  write(data: string): void;
}

export type Export = {
  name: string;
  lastModified: () => Promise<Date | undefined>;
  data: (writer: Writer) => Promise<void>;
};

type ClassicKeys = {
  publicKeys: { plaintext: string }[];
  privateKeys: { plaintext: string }[];
};

const batchSize = 1000;

const safeLastModified = new Date(2024, 0, 1, 0, 0, 0, 0);

// Explicit result types for the paginated findMany loops. Without them the
// cursor back-edge (`cursor:` <- `lastId` <- `objects[last].id`) makes
// inference self-referential and the checker silently collapses the whole
// result to `any` - the blind spot that let the 2026-07-30 blank-options bug
// compile (JITSU-158).
type LinkRow = Prisma.ConfigurationObjectLinkGetPayload<{ include: { from: true; to: true; workspace: true } }>;
type ObjectRow = Prisma.ConfigurationObjectGetPayload<{}>;
type ObjectRowWithWorkspace = Prisma.ConfigurationObjectGetPayload<{ include: { workspace: true } }>;
type StreamRow = Prisma.ConfigurationObjectGetPayload<{
  include: { toLinks: { include: { to: true } }; workspace: true };
}>;
type WorkspaceRow = Prisma.WorkspaceGetPayload<{}>;
type WorkspaceWithProfilesRow = Prisma.WorkspaceGetPayload<{
  include: { profileBuilders: { include: { functions: { include: { function: true } } } } };
}>;

// object-hash ships no type declarations (its type is inferred from JS via
// allowJs) and stable-hash's `exports` map has no `types` condition - the
// inferred import type differs between tsc and the type-aware lint program.
// Pin one explicit signature so every call site type-checks identically.
const hashValue = hash as (value: unknown) => string;
const stableHashValue = stableHash as unknown as (value: unknown) => string;

// Prisma `Json` columns surface as `JsonValue` - reads must go through an
// explicit parse instead of implicit `any`. Parsers are tolerant on purpose:
// a junk field must not fail the export (see logExportEntityError), so
// field-level `catch` drops only the offending field and object-level `catch`
// normalizes a non-object root to {}.
const JsonRecord = z.record(z.unknown());
function asRecord(v: unknown): Record<string, unknown> {
  const parsed = JsonRecord.safeParse(v);
  return parsed.success ? parsed.data : {};
}
// Connection options (ConfigurationObjectLink.data) - the generic fallback
// shape when the destination-type schema can't be applied.
const LinkData = z
  .object({
    disabled: z.unknown().optional(),
    clickhouseSettings: z.unknown().optional(),
    functionsEnv: z.record(z.unknown()).optional().catch(undefined),
  })
  .passthrough()
  .catch({});
type LinkDataParsed = z.infer<typeof LinkData>;

// Parses connection options with the destination type's own connectionOptions
// schema (lib/schema/destinations.tsx), so absent fields materialize to the
// console defaults (deduplicate: true, mode: batch, ...) instead of being
// omitted and re-defaulted - differently and unsafely - by bulker/rotor
// (JITSU-136 / JITSU-158). `.passthrough()` is essential: the schemas strip
// unknown keys by default, and a field consumers understand but the console
// schema doesn't list yet must still flow through. Falls back to the generic
// tolerant parse when the type is unknown or the stored data doesn't conform.
// `.passthrough()` only affects the object it is applied to - unknown keys
// inside nested declared objects (e.g. an `enabled` flag on a functions[]
// entry) would still be stripped. Rebuild the schema with passthrough at
// every object level so stored fields are never silently dropped.
function deepPassthrough(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodObject) {
    const shape = Object.fromEntries(
      Object.entries(schema.shape as z.ZodRawShape).map(([k, v]) => [k, deepPassthrough(v)])
    );
    return z.object(shape).passthrough();
  }
  if (schema instanceof z.ZodArray) {
    return new z.ZodArray({ ...schema._def, type: deepPassthrough(schema._def.type as z.ZodTypeAny) });
  }
  if (schema instanceof z.ZodOptional) {
    return new z.ZodOptional({ ...schema._def, innerType: deepPassthrough(schema._def.innerType as z.ZodTypeAny) });
  }
  if (schema instanceof z.ZodNullable) {
    return new z.ZodNullable({ ...schema._def, innerType: deepPassthrough(schema._def.innerType as z.ZodTypeAny) });
  }
  if (schema instanceof z.ZodDefault) {
    return new z.ZodDefault({ ...schema._def, innerType: deepPassthrough(schema._def.innerType as z.ZodTypeAny) });
  }
  return schema;
}

const linkDataSchemaCache = new Map<string, z.ZodTypeAny>();
function parseLinkData(destinationType: string | undefined, data: unknown): LinkDataParsed {
  // A non-object root is corrupt storage, not options somebody chose: every
  // fallback below would collapse it to {} and the connection would ship with
  // effectively blank options — the JITSU-158 incident shape. Throw instead so
  // each export's per-row catch skips the row and pages via the "System
  // error:" marker. Verified against prod (2026-08-24): zero such rows exist.
  if (data != null && (typeof data !== "object" || Array.isArray(data))) {
    throw new Error(`connection options root must be an object, got ${Array.isArray(data) ? "array" : typeof data}`);
  }
  const coreType = getCoreDestinationTypeNonStrict(destinationType);
  if (coreType) {
    let schema = linkDataSchemaCache.get(coreType.id);
    if (!schema) {
      schema = deepPassthrough(coreType.connectionOptions);
      linkDataSchemaCache.set(coreType.id, schema);
    }
    const parsed = schema.safeParse(data ?? {});
    if (parsed.success) {
      const result = parsed.data as LinkDataParsed;
      // Back-compat: frequency's console default (60m) differs from bulker's
      // absent-option default, so materializing it would change the batch
      // cadence of every connection that never persisted it. Keep it absent
      // unless actually stored.
      if (!(data != null && typeof data === "object" && "frequency" in data)) {
        delete result.frequency;
      }
      return result;
    }
    getLog()
      .atWarn()
      .log(
        `Connection options do not conform to the '${destinationType}' schema, exporting stored fields as-is: ${parsed.error.message}`
      );
  }
  return LinkData.parse(data);
}
// ConfigurationObject.config - the fields the exports read by name.
const ObjectConfig = z
  .object({
    destinationType: z.string().optional().catch(undefined),
    name: z.string().optional().catch(undefined),
  })
  .passthrough()
  .catch({});
// ProfileBuilder.connectionOptions.
const PbConnectionOptions = z
  .object({
    profileWindow: z.unknown().optional(),
    variables: z.unknown().optional(),
    functions: z.array(z.unknown()).optional().catch(undefined),
  })
  .passthrough()
  .catch({});
// ConfigurationObject.config for streams.
const StreamConfig = z
  .object({
    shard: z.unknown().optional(),
    publicKeys: z.array(z.unknown()).optional().catch(undefined),
    privateKeys: z.array(z.unknown()).optional().catch(undefined),
    domains: z.array(z.string()).optional().catch(undefined),
  })
  .passthrough()
  .catch({});

function dateMax(...dates: (Date | undefined)[]): Date | undefined {
  return dates.reduce((acc, d) => (d && (!acc || d.getTime() > acc.getTime()) ? d : acc), undefined);
}

// One malformed entity must not poison the whole export: exports are streamed,
// so an uncaught error mid-stream truncates the payload for every consumer.
// "System error:" is the unified marker for log-based alerting — keep in sync
// with logging.SystemErrorf in bulker/jitsubase
function logExportEntityError(exportName: string, entityId: string, e: unknown) {
  getLog()
    .atError()
    .withCause(e)
    .log(`System error: Failed to export entity '${entityId}' of '${exportName}': ${getErrorMessage(e)}. Skipping`);
}

// Extract functionsClasses from workspace featuresEnabled array
// Looks for feature like "functionsClass=dedicated" or "functionsClass=premium,dedicated"
function extractFunctionsClasses(featuresEnabled: string[]): string[] {
  const prefix = "functionsClasses=";
  for (const feature of featuresEnabled) {
    if (feature.startsWith(prefix)) {
      return feature
        .substring(prefix.length)
        .split(",")
        .map(f => f.trim());
    }
  }
  return [];
}

function addFunctionsClass(featuresEnabled: string[], functionsClass: string): string[] {
  const existing = extractFunctionsClasses(featuresEnabled);
  if (existing.length > 0) {
    return featuresEnabled;
  }
  featuresEnabled.push(`functionsClasses=${functionsClass}`);
  return featuresEnabled;
}

function selectProfileBuilderFunctionsServer(
  functionsServers: Map<string, FunctionsServerDbModel>,
  workspaceId: string,
  profileBuilderId: string,
  functionsClass: string
) {
  for (const pr of functionsClassesPriorities[functionsClass] || defaultClassesPriorities) {
    const fs = functionsServers.get(`${workspaceId}_${pr}`);
    if (fs && fs.profileBuilders?.includes(profileBuilderId)) {
      return {
        deploymentId: fs.deploymentId,
      };
    }
  }
  return undefined;
}

function selectFunctionsServer(
  functionsServers: Map<string, FunctionsServerDbModel>,
  workspaceId: string,
  conId: string,
  functionsClass: string
) {
  let functionsServer:
    | {
        deploymentId: string;
        status: "functions" | "empty" | "missing";
      }
    | undefined = undefined;
  for (const pr of functionsClassesPriorities[functionsClass] || defaultClassesPriorities) {
    const fs = functionsServers.get(`${workspaceId}_${pr}`);
    if (fs) {
      functionsServer = {
        deploymentId: fs.deploymentId,
        status: fs.connections.includes(conId)
          ? "functions"
          : fs.emptyConnections.includes(conId)
          ? "empty"
          : "missing",
      };
      break;
    }
  }
  return functionsServer;
}

async function getLastUpdated(): Promise<Date | undefined> {
  const rows = await db.prisma().$queryRaw<{ last_updated: Date | null }[]>`
        select
            greatest(
                    (select max("updatedAt") from newjitsu."ConfigurationObjectLink"),
                    (select max("updatedAt") from newjitsu."ProfileBuilder"),
                    (select max("updatedAt") from newjitsu."ConfigurationObject"),
                    (select max("updatedAt") from newjitsu."FunctionsServer"),
                    (select max("updatedAt") from newjitsu."Workspace"),
                    -- backup retention lives in WorkspaceOptions(namespace='data-retention');
                    -- a retention change must invalidate streams-with-destinations
                    -- (backupEnabled) and bulker-connections (backup destinations).
                    -- observability-exports settings synthesize otlp connections
                    -- into bulker-connections, so they invalidate too.
                    -- Scoped to these namespaces: getLastUpdated() also gates
                    -- rotor-connections/functions/syncs, which don't read options.
                    (select max("updatedAt") from newjitsu."WorkspaceOptions" where namespace in ('data-retention', 'observability-exports'))
            ) as "last_updated"`;
  return rows[0]?.last_updated ?? undefined;
}

// Workspaces with the Live Events observability export enabled (JITSU-138) →
// parsed settings + row timestamp. Drives the synthesized otlp connections in
// bulker-connections and the per-workspace otlpExportEnabled flags in
// streams-with-destinations / workspaces-with-profiles
async function getEnabledObservabilityExports(): Promise<
  Map<string, { settings: ObservabilityExportsSettings; updatedAt: Date }>
> {
  const rows = await db.prisma().workspaceOptions.findMany({
    where: { namespace: observabilityExportsNamespace, workspace: { deleted: false } },
    // (workspaceId, namespace) has no unique constraint (see the data-retention
    // comment above): ascending order + Map overwrite = freshest row wins,
    // deterministically; id as same-millisecond tiebreaker
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  const result = new Map<string, { settings: ObservabilityExportsSettings; updatedAt: Date }>();
  for (const row of rows) {
    const parsed = ObservabilityExportsSettings.safeParse(row.value);
    if (parsed.success && parsed.data.enabled && parsed.data.endpoint) {
      result.set(row.workspaceId, { settings: parsed.data, updatedAt: row.updatedAt });
    } else {
      // a stale duplicate must not shadow-delete a newer enabled row — only a
      // newer disabled/invalid row turns the workspace off
      result.delete(row.workspaceId);
    }
  }
  return result;
}

async function exportBulkerConnections(writer: Writer) {
  //pull event-archive (GCS/S3 backup) connections from ee-api BEFORE writing
  //anything: an ee-api failure then surfaces as a clean 500 (headers not yet
  //sent) instead of a truncated 200, and bulker/config-keeper keep their last
  //good config. This export is consumed by the bulker service — there is no
  //signed-in user — so it authenticates with the static service token.
  //
  //Deliberately NOT wrapped in try/catch: swallowing an ee-api failure here
  //used to ship a well-formed export with no backup destinations at all,
  //silently disarming archiving fleet-wide.
  let backupConnections: unknown[] = [];
  if (isEEAvailable()) {
    const url = `${getEeConnection().host}api/s3-connections`;
    const response: unknown = await rpc(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...serviceTokenHeaders(),
      },
      // A stalled ee-api must fail this export fast (clean 500, bulker keeps
      // its last good config), not hang the request until infra timeouts.
      signal: AbortSignal.timeout(15_000),
    });
    if (!Array.isArray(response)) {
      //ee-api returns {error: "..."} when its object storage isn't configured
      throw new Error(`Unexpected s3-connections response: ${JSON.stringify(response)}`);
    }
    backupConnections = response;
  }

  // Observability exports (JITSU-138): each workspace with an enabled export gets
  // one synthesized internal `otlp` connection. Live-events write sites produce
  // envelope records into its batch topic; bulker's otlp destination posts them
  // to the configured endpoint. Not a ConfigurationObject — the source of truth
  // is WorkspaceOptions(namespace='observability-exports'), edited in
  // /settings/observability-exports. Built fully BEFORE the streaming write for
  // the same reason as backupConnections above: a failure here must surface as
  // a clean 500, never a truncated 200.
  const observabilityExports = await getEnabledObservabilityExports();
  const otlpConnections = [...observabilityExports].map(([workspaceId, { settings, updatedAt }]) => ({
    __debug: {
      workspace: { id: workspaceId },
    },
    id: `${workspaceId}_otlp`,
    workspaceId: workspaceId,
    special: "otlp",
    type: "otlp",
    options: {
      mode: "batch",
      // fraction of a minute — logs should land in the backend reasonably fresh
      frequency: 0.5,
      deduplicate: false,
    },
    updatedAt: updatedAt,
    credentials: {
      endpoint: settings.endpoint,
      headers: settings.headers,
    },
  }));

  writer.write("[");

  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects: LinkRow[] = await db.prisma().configurationObjectLink.findMany({
      where: {
        deleted: false,
        OR: [{ type: "push" }, { type: null }],
        workspace: { deleted: false },
        from: { deleted: false },
        to: { deleted: false },
      },
      include: { from: true, to: true, workspace: true },
      take: batchSize,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: "asc" },
    });
    if (objects.length == 0) {
      break;
    }
    getLog().atDebug().log(`Got batch of ${objects.length} objects for bulker export`);
    lastId = objects[objects.length - 1].id;
    for (const { data: data_, from, id, to, updatedAt, workspace } of objects) {
      let payload: string | undefined;
      try {
        const toConfig = ObjectConfig.parse(to.config);
        const destinationType = toConfig.destinationType;
        const data = parseLinkData(destinationType, data_);
        if (data.disabled) {
          continue; // skip disabled connections
        }
        const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
        if (coreDestinationType?.usesBulker || coreDestinationType?.hybrid) {
          const credentials: Record<string, unknown> = omit(toConfig, "destinationType", "type", "name");
          if (destinationType === "clickhouse") {
            if (typeof data.clickhouseSettings === "string") {
              const extraParams = Object.fromEntries(
                data.clickhouseSettings
                  .split("\n")
                  .filter(s => s.includes("="))
                  .map(s => s.split("="))
                  .map(([k, v]) => [k.trim(), v.trim()])
              );
              credentials.parameters = { ...asRecord(credentials.parameters), ...extraParams };
            }
            if (!credentials.provisioned) {
              credentials.loadAsJson = false;
            }
          }
          // if (data.timestampColumn) {
          //   // use timestampColumn field as discriminator field when doing local deduplication
          //   // inside batch of two rows having the same messageId(pk) will be chosen the one with the highest timestampColumn value
          //   data.discriminatorField = [data.timestampColumn];
          // }
          // Output contract (JITSU-181, postmortem item 5): a row violating the
          // consumer contract throws here and is skipped-and-logged by the
          // catch below — never shipped malformed to consumers.
          payload = JSON.stringify(
            BulkerConnectionRow.parse({
              __debug: {
                workspace: { id: workspace.id, name: workspace.slug },
              },
              id: id,
              workspaceId: workspace.id,
              type: destinationType,
              options: omit(data, "clickhouseSettings"),
              updatedAt: dateMax(updatedAt, to.updatedAt),
              credentials: credentials,
            })
          );
        }
      } catch (e) {
        // Only entity materialization/serialization is guarded: one malformed row
        // must not take down the whole export. Writes happen OUTSIDE the try so a
        // failing stream aborts the export instead of silently scanning on.
        logExportEntityError("bulker-connections", id, e);
        continue;
      }
      if (payload === undefined) {
        continue;
      }
      if (needComma) {
        writer.write(",");
      }
      writer.write(payload);
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  lastId = undefined;
  while (true) {
    const objects: ObjectRowWithWorkspace[] = await db.prisma().configurationObject.findMany({
      where: { deleted: false, type: "destination", workspace: { deleted: false } },
      include: { workspace: true },
      take: batchSize,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: "asc" },
    });
    if (objects.length == 0) {
      break;
    }
    getLog().atDebug().log(`Got batch of ${objects.length} destinations objects for bulker export`);
    lastId = objects[objects.length - 1].id;
    for (const { id, workspace, config, updatedAt } of objects) {
      let payload: string | undefined;
      try {
        const parsedConfig = ObjectConfig.parse(config);
        const destinationType = parsedConfig.destinationType;
        const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
        if (coreDestinationType?.usesBulker || coreDestinationType?.hybrid) {
          payload = JSON.stringify(
            BulkerConnectionRow.parse({
              __debug: {
                workspace: { id: workspace.id, name: workspace.slug },
              },
              id: id,
              workspaceId: workspace.id,
              type: destinationType,
              options: {
                mode: "batch",
                frequency: 1,
                deduplicate: true,
              },
              updatedAt: updatedAt,
              credentials: omit(parsedConfig, "destinationType", "type", "name"),
            })
          );
        }
      } catch (e) {
        // Only entity materialization/serialization is guarded: one malformed row
        // must not take down the whole export. Writes happen OUTSIDE the try so a
        // failing stream aborts the export instead of silently scanning on.
        logExportEntityError("bulker-connections", id, e);
        continue;
      }
      if (payload === undefined) {
        continue;
      }
      if (needComma) {
        writer.write(",");
      }
      writer.write(payload);
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  for (const conn of otlpConnections) {
    let payload: string | undefined;
    try {
      payload = JSON.stringify(BulkerConnectionRow.parse(conn));
    } catch (e) {
      logExportEntityError("bulker-connections", conn.id, e);
      continue;
    }
    if (needComma) {
      writer.write(",");
    }
    writer.write(payload);
    needComma = true;
  }

  for (const conn of backupConnections) {
    // prebuilt by ee-api — the contract vouches only for the identity field
    let payload: string | undefined;
    try {
      payload = JSON.stringify(BackupConnectionRow.parse(conn));
    } catch (e) {
      // do not stringify the row here: a raw ee-api s3-connection carries
      // credential material that must not reach the alerting log stream
      logExportEntityError("bulker-connections", String((conn as { id?: unknown })?.id ?? "backup:unknown-id"), e);
      continue;
    }
    if (needComma) {
      writer.write(",");
    }
    writer.write(payload);
    needComma = true;
  }

  writer.write("]");
}

async function exportRotorConnections(writer: Writer) {
  const workspacesWithClasses = await functionsClassByWorkspace();
  const functionsClassFunc = (workspace: { id: string; featuresEnabled?: string[] | null }) =>
    extractFunctionsClasses(workspace.featuresEnabled ?? [])[0] ||
    workspacesWithClasses.get(workspace.id)?.class ||
    defaultFunctionsClass;
  const functionsServers = new Map<string, FunctionsServerDbModel>();
  const functionsServersRows = await db.prisma().functionsServer.findMany();
  for (const fs of functionsServersRows) {
    functionsServers.set(`${fs.workspaceId}_${fs.class}`, fs);
  }
  writer.write("[");

  let lastId: string | undefined = undefined;
  let needComma = false;
  const profileBuilders = await db.prisma().profileBuilder.findMany({
    where: {
      deleted: false,
      workspace: { deleted: false },
      version: { gt: 0 },
    },
    include: { workspace: true },
    orderBy: { id: "asc" },
  });
  while (true) {
    const objects: LinkRow[] = await db.prisma().configurationObjectLink.findMany({
      where: {
        deleted: false,
        NOT: { type: "sync" },
        workspace: { deleted: false },
        from: { deleted: false },
        to: { deleted: false },
      },
      include: { from: true, to: true, workspace: true },
      take: batchSize,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: "asc" },
    });
    if (objects.length == 0) {
      break;
    }
    getLog().atDebug().log(`Got batch of ${objects.length} objects for bulker export`);
    lastId = objects[objects.length - 1].id;
    for (const { data: data_, from, id, to, updatedAt, workspace } of objects) {
      let payload: string | undefined;
      try {
        const destinationType = ObjectConfig.parse(to.config).destinationType;
        const data = parseLinkData(destinationType, data_);
        if (data.disabled) {
          continue; // skip disabled connections
        }
        const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
        if (!coreDestinationType) {
          getLog().atError().log(`Unknown destination type: ${destinationType} for connection ${id}`);
        }
        const credentials = omit(asRecord(to.config), "destinationType", "type", "name");
        // Output contract (JITSU-181): a violating row throws and is
        // skipped-and-logged by the catch below — never shipped malformed.
        payload = JSON.stringify(
          RotorConnectionRow.parse({
            __debug: {
              workspace: { id: workspace.id, name: workspace.slug },
            },
            id: id,
            type: destinationType,
            workspaceId: workspace.id,
            streamId: from.id,
            streamName: ObjectConfig.parse(from.config).name,
            destinationId: to.id,
            usesBulker: !!coreDestinationType?.usesBulker,
            options: {
              ...data,
              ...((workspace.featuresEnabled ?? []).includes("nofetchlogs") &&
              data.functionsEnv?.FETCH_LOGS_ENABLED !== "true"
                ? { fetchLogLevel: "debug" }
                : {}),
              ...((workspace.featuresEnabled ?? []).includes("fastFunctions") ? { fastFunctions: true } : {}),
              functionsServer: selectFunctionsServer(functionsServers, workspace.id, id, functionsClassFunc(workspace)),
              workspaceUpdatedAt: workspace.updatedAt,
            },
            optionsHash: hashValue(data),
            updatedAt: dateMax(updatedAt, to.updatedAt),
            credentials: credentials,
            credentialsHash: hashValue(credentials),
          })
        );
      } catch (e) {
        // Only entity materialization/serialization is guarded: one malformed row
        // must not take down the whole export. Writes happen OUTSIDE the try so a
        // failing stream aborts the export instead of silently scanning on.
        logExportEntityError("rotor-connections", id, e);
        continue;
      }
      if (payload === undefined) {
        continue;
      }
      if (needComma) {
        writer.write(",");
      }
      writer.write(payload);
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  lastId = undefined;
  while (true) {
    const objects: ObjectRowWithWorkspace[] = await db.prisma().configurationObject.findMany({
      where: { deleted: false, type: "destination", workspace: { deleted: false } },
      include: { workspace: true },
      take: batchSize,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: "asc" },
    });
    if (objects.length == 0) {
      break;
    }
    getLog().atDebug().log(`Got batch of ${objects.length} destinations objects for bulker export`);
    lastId = objects[objects.length - 1].id;
    for (const { id, workspace, config, updatedAt } of objects) {
      let payload: string | undefined;
      try {
        const parsedConfig = ObjectConfig.parse(config);
        const destinationType = parsedConfig.destinationType;
        const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
        if (coreDestinationType?.usesBulker || coreDestinationType?.hybrid) {
          const credentials = omit(parsedConfig, "destinationType", "type", "name");
          payload = JSON.stringify(
            RotorDestinationRow.parse({
              id: id,
              type: destinationType,
              workspaceId: workspace.id,
              streamId: id,
              streamName: parsedConfig.name,
              destinationId: id,
              usesBulker: !!coreDestinationType?.usesBulker,
              updatedAt: updatedAt,
              credentials: credentials,
              credentialsHash: hashValue(credentials),
            })
          );
        }
      } catch (e) {
        // Only entity materialization/serialization is guarded: one malformed row
        // must not take down the whole export. Writes happen OUTSIDE the try so a
        // failing stream aborts the export instead of silently scanning on.
        logExportEntityError("rotor-connections", id, e);
        continue;
      }
      if (payload === undefined) {
        continue;
      }
      if (needComma) {
        writer.write(",");
      }
      writer.write(payload);
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  for (const pb of profileBuilders) {
    let payload: string | undefined;
    try {
      const connectionOptions = PbConnectionOptions.parse(pb.connectionOptions);
      const cred = {
        ...asRecord(pb.intermediateStorageCredentials),
        profileWindowDays: connectionOptions.profileWindow,
        profileBuilderId: pb.id,
        eventsCollectionName: `profiles-raw-${pb.workspace.id}-${pb.id}`,
        traitsCollectionName: `profiles-traits-${pb.workspace.id}-${pb.id}`,
      };
      const opts = {
        functionsEnv: connectionOptions.variables,
        functions: [
          {
            functionId: "builtin.transformation.user-recognition",
          },
          ...(connectionOptions.functions ?? []),
        ],
        functionsServer: selectFunctionsServer(
          functionsServers,
          pb.workspace.id,
          pb.id,
          functionsClassFunc(pb.workspace)
        ),
        workspaceUpdatedAt: pb.workspace.updatedAt,
      };
      payload = JSON.stringify(
        RotorConnectionRow.parse({
          __debug: {
            workspace: { id: pb.workspaceId },
          },
          id: pb.id,
          type: "profiles",
          workspaceId: pb.workspaceId,
          streamId: pb.id,
          streamName: "profiles",
          destinationId: pb.destinationId,
          usesBulker: false,
          options: opts,
          optionsHash: hashValue(opts),
          updatedAt: pb.updatedAt,
          credentials: cred,
          credentialsHash: hashValue(cred),
        })
      );
    } catch (e) {
      // Only entity materialization/serialization is guarded: one malformed row
      // must not take down the whole export. Writes happen OUTSIDE the try so a
      // failing stream aborts the export instead of silently scanning on.
      logExportEntityError("rotor-connections", pb.id, e);
      continue;
    }
    if (payload === undefined) {
      continue;
    }
    if (needComma) {
      writer.write(",");
    }
    writer.write(payload);
    needComma = true;
  }
  writer.write("]");
}

async function exportFunctions(writer: Writer) {
  writer.write("[");

  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects: ObjectRow[] = await db.prisma().configurationObject.findMany({
      where: {
        deleted: false,
        type: "function",
        workspace: { deleted: false },
      },
      take: batchSize,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: "asc" },
    });
    if (objects.length == 0) {
      break;
    }
    getLog().atDebug().log(`Got batch of ${objects.length} objects for bulker export`);
    lastId = objects[objects.length - 1].id;
    for (const row of objects) {
      let payload: string | undefined;
      try {
        const config = asRecord(row.config);
        payload = JSON.stringify({
          ...omit(row, "deleted", "config"),
          ...config,
          codeHash: hashValue(config.code || config.draft || ""),
        });
      } catch (e) {
        // Only entity materialization/serialization is guarded: one malformed row
        // must not take down the whole export. Writes happen OUTSIDE the try so a
        // failing stream aborts the export instead of silently scanning on.
        logExportEntityError("functions", row.id, e);
        continue;
      }
      if (payload === undefined) {
        continue;
      }
      if (needComma) {
        writer.write(",");
      }
      writer.write(payload);
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  writer.write("]");
}

async function exportStreamsWithDestinations(writer: Writer) {
  const workspacesWithClasses = await functionsClassByWorkspace();
  const functionsClassFunc = (workspace: { id: string; featuresEnabled?: string[] | null }) =>
    extractFunctionsClasses(workspace.featuresEnabled ?? [])[0] ||
    workspacesWithClasses.get(workspace.id)?.class ||
    defaultFunctionsClass;
  const functionsServers = new Map<string, FunctionsServerDbModel>();
  const functionsServersRows = await db.prisma().functionsServer.findMany();
  for (const fs of functionsServersRows) {
    functionsServers.set(`${fs.workspaceId}_${fs.class}`, fs);
  }
  const domains = await db.prisma().configurationObject.findMany({
    where: { deleted: false, type: "domain", workspace: { deleted: false } },
  });
  const domainsMap = new Map<string, string[]>();
  for (const domain of domains) {
    const name = ObjectConfig.parse(domain.config).name;
    if (name && !name.includes("*")) {
      const d = domainsMap.get(domain.workspaceId) || [];
      domainsMap.set(domain.workspaceId, [...d, name]);
    }
  }
  const classicMappings = await db.prisma().configurationObject.findMany({
    where: {
      deleted: false,
      type: "misc",
      config: { path: ["objectType"], equals: "classic-mapping" },
      workspace: { deleted: false },
    },
  });
  const classicKeysMap: Record<string, ClassicKeys> = {};
  classicMappings
    .map(c => asRecord(c.config).value)
    .filter((value): value is string => typeof value === "string" && value !== "")
    .flatMap(value => value.split("\n"))
    .forEach(line => {
      const [source, apikey] = line.split(/=(.*)/s).map((s: string) => s.trim());
      if (source && apikey) {
        const keys = classicKeysMap[source] || { publicKeys: [], privateKeys: [] };
        if (apikey.startsWith("s2s.")) {
          keys.privateKeys.push({ plaintext: apikey });
        } else {
          keys.publicKeys.push({ plaintext: apikey });
        }
        classicKeysMap[source] = keys;
      }
    });
  const profileBuilders = await db.prisma().profileBuilder.findMany({
    where: {
      deleted: false,
      workspace: { deleted: false },
      version: { gt: 0 },
    },
    orderBy: { id: "asc" },
  });
  const pbMap = new Map<string, typeof profileBuilders>();
  for (const pb of profileBuilders) {
    const pbs = pbMap.get(pb.workspaceId) || [];
    pbMap.set(pb.workspaceId, [...pbs, pb]);
  }
  // backup retention per workspace — drives backupEnabled below. Ascending
  // order + Map overwrite = freshest row wins: (workspaceId, namespace) has no
  // unique constraint, and the write path's find-then-create race can leave
  // duplicate rows.
  const dataRetentionMap = new Map<string, unknown>(
    (
      await db.prisma().workspaceOptions.findMany({
        where: { namespace: "data-retention" },
        // id as tiebreaker: same-millisecond concurrent writes (the very race
        // that creates duplicates) can share an updatedAt
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      })
    ).map(row => [row.workspaceId, row.value])
  );
  const observabilityExports = await getEnabledObservabilityExports();

  writer.write("[");
  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects: StreamRow[] = await db.prisma().configurationObject.findMany({
      where: { deleted: false, type: "stream", workspace: { deleted: false } },
      include: { toLinks: { include: { to: true } }, workspace: true },
      take: batchSize,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: "asc" },
    });
    if (objects.length == 0) {
      break;
    }
    getLog().atDebug().log(`Got batch of ${objects.length} objects for streams-with-destinations export`);
    lastId = objects[objects.length - 1].id;
    for (const obj of objects) {
      let payload: string | undefined;
      try {
        const streamConfig = StreamConfig.parse(obj.config);
        const throttlePercent =
          workspacesWithClasses.get(obj.workspace.id)?.status !== "active"
            ? getNumericOption("throttle", obj.workspace)
            : undefined;
        const shardNumber = streamConfig.shard || getNumericOption("shard", obj.workspace);
        const classicKeys = classicKeysMap[obj.id] || ({} as ClassicKeys);
        payload = JSON.stringify({
          __debug: {
            workspace: { id: obj.workspace.id, name: obj.workspace.slug },
          },
          id: obj.id,
          stream: {
            ...omit(obj, "type", "workspaceId", "config", "toLinks", "deleted", "createdAt", "updatedAt", "workspace"),
            ...{
              ...omit(streamConfig, "shard"),
              publicKeys: [classicKeys.publicKeys ?? [], streamConfig.publicKeys ?? []].flat(),
              privateKeys: [classicKeys.privateKeys ?? [], streamConfig.privateKeys ?? []].flat(),
              domains: [...new Set([...(domainsMap.get(obj.workspace.id) ?? []), ...(streamConfig.domains ?? [])])],
            },
            workspaceId: obj.workspace.id,
          },
          backupEnabled:
            isEEAvailable() && isBackupEnabled(obj.workspace.featuresEnabled, dataRetentionMap.get(obj.workspace.id)),
          throttle: throttlePercent,
          shard: shardNumber,
          // opt-in per workspace (Settings → Capture HTTP headers): ingest stores
          // request headers in event context.headers (AI agent / bot detection)
          captureHeaders: (obj.workspace.featuresEnabled || []).includes("captureHeaders"),
          // Live Events observability export (JITSU-138): ingest fans function
          // events out to the workspace's otlp topic when enabled
          otlpExportEnabled: observabilityExports.has(obj.workspace.id),
          destinations: [
            ...obj.toLinks
              .filter(l => !l.deleted && l.type === "push" && !l.to.deleted)
              .flatMap(l => {
                // per-link guard: one corrupt link must drop only itself, not
                // the whole stream row (ingest routes events by stream — a
                // missing stream row would reject the site's traffic)
                try {
                  const toConfig = ObjectConfig.parse(l.to.config);
                  return [{ l, toConfig, data: parseLinkData(toConfig.destinationType, l.data) }];
                } catch (e) {
                  logExportEntityError("streams-with-destinations", l.id, e);
                  return [];
                }
              })
              .filter(({ data }) => !data.disabled)
              .map(({ l, toConfig, data }) => ({
                id: l.to.id,
                connectionId: l.id,
                destinationType: toConfig.destinationType,
                name: toConfig.name,
                credentials: omit(toConfig, "destinationType", "type", "name"),
                options: {
                  ...data,
                  functionsServer: selectFunctionsServer(
                    functionsServers,
                    obj.workspace.id,
                    l.id,
                    functionsClassFunc(obj.workspace)
                  ),
                },
              })),
            ...(pbMap.get(obj.workspace.id) ?? []).map(pb => {
              const connectionOptions = PbConnectionOptions.parse(pb.connectionOptions);
              return {
                id: pb.id,
                connectionId: pb.id,
                destinationType: "profiles",
                name: "profiles",
                credentials: {
                  ...asRecord(pb.intermediateStorageCredentials),
                  profileWindowDays: connectionOptions.profileWindow,
                  profileBuilderId: pb.id,
                  eventsCollectionName: `profiles-raw-${obj.workspace.id}-${pb.id}`,
                  traitsCollectionName: `profiles-traits-${obj.workspace.id}-${pb.id}`,
                },
                options: {
                  functionsEnv: connectionOptions.variables,
                  functions: connectionOptions.functions,
                },
              };
            }),
          ],
        });
      } catch (e) {
        // Only entity materialization/serialization is guarded: one malformed row
        // must not take down the whole export. Writes happen OUTSIDE the try so a
        // failing stream aborts the export instead of silently scanning on.
        logExportEntityError("streams-with-destinations", obj.id, e);
        continue;
      }
      if (payload === undefined) {
        continue;
      }
      if (needComma) {
        writer.write(",");
      }
      writer.write(payload);
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  writer.write("]");
}

async function exportWorkspacesLastModified(): Promise<Date | undefined> {
  const rows = await db.prisma().$queryRaw<
    { last_updated: Date | null }[]
  >`select max("updatedAt") as "last_updated" from newjitsu."Workspace"`;
  const lastUpdated = rows[0]?.last_updated ?? undefined;
  // force refresh every 5 minute to actualize possible subscription status changes or expirations
  const forceRefreshEveryMs = 5 * 60 * 1000;
  if (!lastUpdated || lastUpdated.getTime() < Date.now() - forceRefreshEveryMs) {
    return new Date(Math.floor(Date.now() / forceRefreshEveryMs) * forceRefreshEveryMs);
  }
  return lastUpdated;
}

async function functionsClassByWorkspace(): Promise<Map<string, { class: string; status: string }>> {
  if (!isEEAvailable()) {
    return new Map();
  }
  const now = Date.now();
  const workspacesWithClasses = new Map<string, { class: string; status: string }>();
  const rows = await db.pgPool().query<{
    id: string;
    status: string;
    period_end: Date | null;
  }>(`with customers as (select obj -> 'customer' ->> 'id'         as customer_id,
                                        obj -> 'subscription' ->> 'status' as status,
                                        (obj -> 'subscription' -> 'current_period_end')::int  as period_end
                                 from newjitsuee.kvstore
                                 where namespace = 'stripe-customer-info'
                                 order by status),
                   settings
                     as (select id as workspace_id, obj ->> 'stripeCustomerId' as customer_id
                         from newjitsuee.kvstore
                         where namespace = 'stripe-settings')
              select id::text, COALESCE(status, '')::text as status, TO_TIMESTAMP(period_end) period_end
              from newjitsu."Workspace"
                     left join settings s on s.workspace_id = "Workspace".id
                     left join customers c on c.customer_id = s.customer_id
              where status<>''`);
  for (const row of rows.rows) {
    const status = row.status;
    if (status === "active" || status === "trialing" || status === "past_due" || status === "unpaid") {
      workspacesWithClasses.set(row.id, { class: "dedicated", status: "active" });
    } else if (status === "canceled") {
      if (row.period_end && row.period_end.getTime() > now) {
        workspacesWithClasses.set(row.id, { class: "dedicated", status: "active" });
      }
    }
  }
  return workspacesWithClasses;
}

async function exportWorkspaces(writer: Writer) {
  const workspacesWithClasses = await functionsClassByWorkspace();
  const functionsClassFunc = (workspaceId: string) =>
    workspacesWithClasses.get(workspaceId)?.class || defaultFunctionsClass;

  writer.write("[");
  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects: WorkspaceRow[] = await db.prisma().workspace.findMany({
      where: {
        deleted: false,
      },
      take: batchSize,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: "asc" },
    });
    if (objects.length == 0) {
      break;
    }
    getLog().atDebug().log(`Got batch of ${objects.length} objects for bulker export`);
    lastId = objects[objects.length - 1].id;
    for (const row of objects) {
      let payload: string | undefined;
      try {
        row.featuresEnabled = addFunctionsClass(row.featuresEnabled ?? [], functionsClassFunc(row.id));
        payload = JSON.stringify(row);
      } catch (e) {
        // Only entity materialization/serialization is guarded: one malformed row
        // must not take down the whole export. Writes happen OUTSIDE the try so a
        // failing stream aborts the export instead of silently scanning on.
        logExportEntityError("workspaces", row.id, e);
        continue;
      }
      if (payload === undefined) {
        continue;
      }
      if (needComma) {
        writer.write(",");
      }
      writer.write(payload);
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  writer.write("]");
}

async function exportWorkspacesWithProfilesLastModified(): Promise<Date | undefined> {
  const rows = await db.prisma().$queryRaw<{ last_updated: Date | null }[]>`
            select
              greatest(
                  (select max("updatedAt") from newjitsu."ConfigurationObject" where type='function'),
                  (select max("updatedAt") from newjitsu."ProfileBuilder"),
                  (select max("updatedAt") from newjitsu."ProfileBuilderFunction"),
                  (select max("updatedAt") from newjitsu."Workspace"),
                  -- rotor gates the live-events observability export (JITSU-138) on
                  -- the otlpExportEnabled flag injected into this export
                  (select max("updatedAt") from newjitsu."WorkspaceOptions" where namespace = 'observability-exports')
              ) as "last_updated"`;
  const lastUpdated = rows[0]?.last_updated ?? undefined;
  // force refresh every 5 minute to actualize possible subscription status changes or expirations
  const forceRefreshEveryMs = 5 * 60 * 1000;
  if (!lastUpdated || lastUpdated.getTime() < Date.now() - forceRefreshEveryMs) {
    return new Date(Math.floor(Date.now() / forceRefreshEveryMs) * forceRefreshEveryMs);
  }
  return lastUpdated;
}

async function exportWorkspacesWithProfiles(writer: Writer) {
  const workspacesWithClasses = await functionsClassByWorkspace();
  const functionsClassFunc = (workspaceId: string) =>
    workspacesWithClasses.get(workspaceId)?.class || defaultFunctionsClass;
  // Observability exports (JITSU-138): rotor gates its live-events fan-out on
  // this per-workspace flag (the otlp topic name is derived from the workspace
  // id, so a boolean is all rotor needs)
  const observabilityExports = await getEnabledObservabilityExports();

  // Load FunctionsServer records for profile builder routing
  const functionsServers = new Map<string, FunctionsServerDbModel>();
  try {
    const fsRows = await db.prisma().functionsServer.findMany();
    for (const fs of fsRows) {
      functionsServers.set(`${fs.workspaceId}_${fs.class}`, fs);
    }
  } catch (e) {
    getLog()
      .atWarn()
      .log(`Failed to load FunctionsServer table for profile builder routing: ${getErrorMessage(e)}`);
  }

  writer.write("[");
  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects: WorkspaceWithProfilesRow[] = await db.prisma().workspace.findMany({
      where: {
        deleted: false,
      },
      include: { profileBuilders: { include: { functions: { include: { function: true } } } } },
      take: batchSize,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: "asc" },
    });
    if (objects.length == 0) {
      break;
    }
    getLog().atDebug().log(`Got batch of ${objects.length} objects for bulker export`);
    lastId = objects[objects.length - 1].id;
    for (const row of objects) {
      let payload: string | undefined;
      try {
        const workspacePayload = {
          ...row,
          featuresEnabled: addFunctionsClass(row.featuresEnabled ?? [], functionsClassFunc(row.id)),
          // Live Events observability export (JITSU-138): rotor's per-workspace gate
          otlpExportEnabled: observabilityExports.has(row.id),
          profileBuilders: row.profileBuilders
            .filter(pb => pb.version > 0)
            .map(pb => ({
              ...pb,
              functions: pb.functions.map(f => ({
                ...omit(f.function, "config"),
                ...asRecord(f.function.config),
              })),
              // functionsServer routing info for profile builder
              functionsServer: selectProfileBuilderFunctionsServer(
                functionsServers,
                row.id,
                pb.id,
                functionsClassFunc(row.id)
              ),
            })),
        };
        payload = JSON.stringify(workspacePayload);
      } catch (e) {
        // Only entity materialization/serialization is guarded: one malformed row
        // must not take down the whole export. Writes happen OUTSIDE the try so a
        // failing stream aborts the export instead of silently scanning on.
        logExportEntityError("workspaces-with-profiles", row.id, e);
        continue;
      }
      if (payload === undefined) {
        continue;
      }
      if (needComma) {
        writer.write(",");
      }
      writer.write(payload);
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  writer.write("]");
}

// Consumed by syncctl, which polls this to know what CronJobs to manage and
// how to construct each Pod's run config. Each entry is a self-sufficient
// snapshot of everything needed to schedule a sync:
//
//   - identity (id, workspaceId, fromId, toId)
//   - schedule + timezone (drives CronJob spec)
//   - source.config (full service config with raw stored credentials, plus
//     source.authorized flag for OAuth-using services). The Pod's
//     oauth-refresh init container calls Nango at run time to swap stale
//     access tokens for fresh ones — so this export ships the *stored*
//     credentials, not refreshed ones. Refreshing here would just waste
//     Nango calls per poll and the tokens might still be stale by the time
//     the CronJob fires.
//   - destination.config (full destination config)
//   - sync.data (streams, disabledStreams, schemaChanges, namespace,
//     deduplicate, …) — sidecar reads streams/disabledStreams/schemaChanges
//     from here and applies selectStreamsFromCatalog logic itself
//
// Three things deliberately NOT in the export:
//   - refreshed OAuth tokens: handled at run time by the oauth-refresh init
//     container in the sync Pod (sync-sidecar's `oauth-refresh` subcommand).
//   - catalog: too large to ship per poll. Sidecar reads it from
//     newjitsu.source_catalog directly using (package, version, versionHash).
//   - source_state: changes per run. Sidecar reads/writes it directly.
async function exportSyncs(writer: Writer) {
  writer.write("[");

  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects: LinkRow[] = await db.prisma().configurationObjectLink.findMany({
      where: {
        deleted: false,
        type: "sync",
        workspace: { deleted: false },
        from: { deleted: false },
        to: { deleted: false },
      },
      include: { from: true, to: true, workspace: true },
      take: batchSize,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: "asc" },
    });
    if (objects.length == 0) {
      break;
    }
    getLog().atDebug().log(`Got batch of ${objects.length} syncs for export`);
    lastId = objects[objects.length - 1].id;

    const enriched = objects.flatMap(({ data, from, id, to, updatedAt, workspace }) => {
      try {
        // Every sync is scheduled by syncctl CronJobs — emit all of them.
        // (Destination-type filters below still skip syncs whose pod template
        // can't run them, e.g. non-bulker mixpanel-with-syncs.)
        return exportSyncEntity({ data, from, id, to, updatedAt, workspace });
      } catch (e) {
        // Do NOT skip-and-continue here: syncctl reconciles desired state from
        // this export and deletes CronJobs that are absent from it, so omitting
        // a sync because its row failed to materialize would tear down a healthy
        // sync. Fail the whole export instead — consumers keep their last known
        // good snapshot (stale is safe, wrong is not).
        logExportEntityError("syncs", id, e);
        throw e;
      }
    });

    for (const item of enriched) {
      // No per-entity skip anywhere in syncs: omission reads as deletion to
      // syncctl (see catch above), so a serialization failure also fails the
      // whole export rather than dropping the entity.
      const payload = JSON.stringify(item);
      if (needComma) {
        writer.write(",");
      }
      writer.write(payload);
      needComma = true;
    }

    if (objects.length < batchSize) {
      break;
    }
  }
  writer.write("]");
}

function exportSyncEntity({
  data,
  from,
  id,
  to,
  updatedAt,
  workspace,
}: Pick<LinkRow, "data" | "from" | "id" | "to" | "updatedAt" | "workspace">) {
  let destinationConfig: Record<string, unknown> = { ...asRecord(to.config) };
  const destinationType = ObjectConfig.parse(to.config).destinationType;
  const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
  if (!coreDestinationType) {
    getLog()
      .atError()
      .log(`Unknown destination type: ${destinationType} for sync ${id} - skipping export of this sync`);
    return [];
  }
  if (!coreDestinationType.usesBulker && coreDestinationType.id !== "webhook") {
    // Non-bulker destinations (e.g. mixpanel-with-syncs) used to run
    // synchronously inside the console process via scheduleSync's
    // runSynchronously branch — they were never scheduled by GCS, and
    // the autonomous CronJob path doesn't support them either. Skip
    // them out of the export so syncctl doesn't try to reconcile a
    // CronJob whose Pod template can't actually run them.
    getLog()
      .atError()
      .log(
        `Sync ${id} has destination type ${destinationType} which does not use bulker - skipping export of this sync`
      );
    return [];
  }
  const syncData = asRecord(data);
  let serviceConfig: Record<string, unknown> = { ...asRecord(from.config) };

  // versionHash MUST be derived from the raw persisted credentials —
  // matches the formula used by scheduleSync and sources/discover when
  // they store catalog rows in source_catalog. Hashing post-mutation or
  // post-OAuth-refresh creds would make sidecar's catalog lookup miss
  // the rows that scheduleSync wrote.
  const versionHash = `${workspace.id}_${from.id}_${juavaHash("md5", stableHashValue(serviceConfig.credentials))}`;

  // scheduleSync applies this default for these packages — apply it to
  // a separate `credentials` value used only in the runtime source.config
  // (so it doesn't leak into versionHash above).
  if (
    serviceConfig.package === "airbyte/source-postgres" ||
    serviceConfig.package === "airbyte/source-mssql" ||
    serviceConfig.package === "airbyte/source-singlestore"
  ) {
    serviceConfig = {
      ...serviceConfig,
      credentials: { ...asRecord(serviceConfig.credentials), sync_checkpoint_records: 200000 },
    };
  }

  // ClickHouse-without-provisioning override (mirrors scheduleSync).
  if (destinationType === "clickhouse" && !destinationConfig.provisioned) {
    destinationConfig = { ...destinationConfig, loadAsJson: false };
  }

  return [
    {
      id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      fromId: from.id,
      toId: to.id,
      source: serviceConfig,
      destination: destinationConfig,
      schedule: syncData.schedule,
      timezone: syncData.timezone ?? "Etc/UTC",
      // Everything from sync.data minus the fields already promoted to
      // top-level (schedule, timezone), plus the computed versionHash.
      options: {
        ...omit(syncData, "schedule", "timezone"),
        versionHash,
      },
      updatedAt: dateMax(updatedAt, from.updatedAt, to.updatedAt),
    },
  ];
}

const exports: Export[] = [
  {
    name: "bulker-connections",
    lastModified: getLastUpdated,
    data: exportBulkerConnections,
  },
  {
    name: "rotor-connections",
    lastModified: getLastUpdated,
    data: exportRotorConnections,
  },
  {
    name: "functions",
    lastModified: getLastUpdated,
    data: exportFunctions,
  },
  {
    name: "streams-with-destinations",
    lastModified: getLastUpdated,
    data: exportStreamsWithDestinations,
  },
  {
    name: "workspaces",
    lastModified: exportWorkspacesLastModified,
    data: exportWorkspaces,
  },
  {
    name: "workspaces-with-profiles",
    lastModified: exportWorkspacesWithProfilesLastModified,
    data: exportWorkspacesWithProfiles,
  },
  // {
  //   name: "functions-servers",
  //   lastModified: async () => {
  //     try {
  //       return (
  //         (await db.prisma()
  //           .$queryRaw`select greatest(max("createdAt"), max("updatedAt")) as "last_updated" from newjitsu."FunctionsServer"`) as any
  //       )[0]["last_updated"];
  //     } catch (e) {
  //       // Table may not exist yet during migration
  //       return undefined;
  //     }
  //   },
  //   data: async writer => {
  //     writer.write("[");
  //     let needComma = false;
  //     try {
  //       const records = await db.prisma().functionsServer.findMany();
  //       for (const record of records) {
  //         if (needComma) {
  //           writer.write(",");
  //         }
  //         writer.write(
  //           JSON.stringify({
  //             id: `${record.workspaceId}:${record.class}`,
  //             workspaceId: record.workspaceId,
  //             class: record.class,
  //             deploymentId: record.deploymentId,
  //             connections: record.connections,
  //             emptyConnections: record.emptyConnections,
  //             createdAt: record.createdAt,
  //             updatedAt: record.updatedAt,
  //             shutdownAt: record.shutdownAt,
  //           })
  //         );
  //         needComma = true;
  //       }
  //     } catch (e) {
  //       // Table may not exist yet during migration
  //       getLog()
  //         .atWarn()
  //         .log(`Failed to export functions-servers: ${getErrorMessage(e)}`);
  //     }
  //     writer.write("]");
  //   },
  // },
  {
    name: "syncs",
    lastModified: getLastUpdated,
    data: exportSyncs,
  },
];

const exportsMap: Record<string, Export> = exports.reduce((acc, e) => ({ ...acc, [e.name]: e }), {});

export function getExport(name: string): Export {
  return requireDefined(exportsMap[name], `Export ${name} not found`);
}

export function getIfModifiedSince(req: NextApiRequest): Date | undefined {
  const ifModifiedSinceStr = req.headers["if-modified-since"];
  let ifModifiedSince: Date | undefined = undefined;
  try {
    ifModifiedSince = ifModifiedSinceStr ? new Date(ifModifiedSinceStr) : undefined;
  } catch (e) {
    getLog()
      .atWarn()
      .withCause(e)
      .log(`Error parsing if-modified-since header '${ifModifiedSinceStr}': ${getErrorMessage(e)}`);
  }
  return ifModifiedSince;
}

export const ExportQueryParams = z.object({
  name: z.string(),
  listen: z.string().optional(),
  timeoutMs: z.coerce.number().optional().default(10_000),
  dateOnly: z.string().default("false").transform(isTruish),
});

export function notModified(ifModifiedSince: Date | undefined, lastModified: Date | undefined) {
  if (!ifModifiedSince || !lastModified) {
    return false;
  }
  const lastModifiedCopy = new Date(lastModified.getTime());
  // Last-Modified and If-Modified-Since headers are not precise enough, so we need to round it to seconds
  lastModifiedCopy.setMilliseconds(0);
  return ifModifiedSince.getTime() >= lastModifiedCopy.getTime();
}

function getNumericOption(name: string, workspace: { featuresEnabled?: string[] | null }, defaultValue?: number) {
  const opt = (workspace.featuresEnabled ?? []).find(f => f.startsWith(name));
  if (opt) {
    //remove all non-numeric
    const m = opt.match(/(\d+)/);
    if (m && m.length > 1) {
      return Math.min(100, parseInt(m[1]));
    }
  }
  return defaultValue;
}

export default createRoute()
  .OPTIONS({
    auth: true,
    streaming: true,
    query: ExportQueryParams,
  })
  .handler(async ({ user, res, req, query }) => {
    const exp = requireDefined(exportsMap[query.name], `Export ${query.name} not found`);
    await verifyAdmin(user);
    const ifModifiedSince = getIfModifiedSince(req);
    const lastModified = (await exp.lastModified()) || safeLastModified;
    res.setHeader("Last-Modified", lastModified.toUTCString());
    res.status(notModified(ifModifiedSince, lastModified) ? 304 : 200);
    res.end();
    return;
  })
  .GET({
    auth: true,
    streaming: true,
    query: ExportQueryParams,
  })
  .handler(async ({ user, req, res, query }) => {
    await verifyAdmin(user);
    const exp = requireDefined(exportsMap[query.name], `Export ${query.name} not found`);
    const ifModifiedSince = getIfModifiedSince(req);
    let lastModified = (await exp.lastModified()) || safeLastModified;
    if (notModified(ifModifiedSince, lastModified)) {
      if (query.listen) {
        //fake implementation of long polling, switch to pg NOTIFY later
        await new Promise(resolve => setTimeout(resolve, query.timeoutMs));
        lastModified = (await exp.lastModified()) || safeLastModified;
        if (notModified(ifModifiedSince, lastModified)) {
          res.writeHead(304, { "Last-Modified": lastModified.toUTCString() });
          res.end();
          return;
        }
      } else {
        res.writeHead(304, { "Last-Modified": lastModified.toUTCString() });
        res.end();
        return;
      }
    }
    if (lastModified) {
      res.setHeader("Last-Modified", lastModified.toUTCString());
    }
    res.setHeader("Content-Type", "application/json");
    if (query.dateOnly) {
      res.write(JSON.stringify({ lastModified: lastModified.toISOString() }));
    } else {
      try {
        await exp.data(res);
      } catch (e) {
        // Headers are already sent, so this can't become an HTTP 500. Destroy the
        // socket so consumers see an aborted response instead of a seemingly
        // complete but truncated JSON document served with status 200.
        getLog()
          .atError()
          .withCause(e)
          .log(`System error: Export '${query.name}' failed mid-stream: ${getErrorMessage(e)}`);
        res.destroy(e instanceof Error ? e : new Error(getErrorMessage(e)));
        return;
      }
    }
    res.end();
  })
  .toNextApiHandler();
