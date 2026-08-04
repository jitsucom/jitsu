import { createRoute, verifyAdmin } from "../../../../../lib/api";
import { db } from "../../../../../lib/server/db";
import { getErrorMessage, getLog, hash as juavaHash, isTruish, requireDefined, rpc } from "juava";
import { z } from "zod";
import { getCoreDestinationTypeNonStrict } from "../../../../../lib/schema/destinations";
import { getEeConnection, isEEAvailable, serviceTokenHeaders } from "../../../../../lib/server/ee";
import omit from "lodash/omit";
import { NextApiRequest } from "next";
import hash from "object-hash";
import { default as stableHash } from "stable-hash";
import { FunctionsServerDbModel } from "../../../../../prisma/schema";
import { getServerEnv } from "../../../../../lib/server/serverEnv";
import { Prisma } from "@prisma/client";

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
// Connection options (ConfigurationObjectLink.data).
const LinkData = z
  .object({
    disabled: z.unknown().optional(),
    clickhouseSettings: z.unknown().optional(),
    functionsEnv: z.record(z.unknown()).optional().catch(undefined),
  })
  .passthrough()
  .catch({});
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
                    (select max("updatedAt") from newjitsu."Workspace")
            ) as "last_updated"`;
  return rows[0]?.last_updated ?? undefined;
}

async function exportBulkerConnections(writer: Writer) {
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
        const data = LinkData.parse(data_);
        if (data.disabled) {
          continue; // skip disabled connections
        }
        const toConfig = ObjectConfig.parse(to.config);
        const destinationType = toConfig.destinationType;
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
          payload = JSON.stringify({
            __debug: {
              workspace: { id: workspace.id, name: workspace.slug },
            },
            id: id,
            type: destinationType,
            options: omit(data, "clickhouseSettings"),
            updatedAt: dateMax(updatedAt, to.updatedAt),
            credentials: credentials,
          });
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
          payload = JSON.stringify({
            __debug: {
              workspace: { id: workspace.id, name: workspace.slug },
            },
            id: id,
            type: destinationType,
            options: {
              mode: "batch",
              frequency: 1,
              deduplicate: true,
            },
            updatedAt: updatedAt,
            credentials: omit(parsedConfig, "destinationType", "type", "name"),
          });
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
  if (isEEAvailable()) {
    //pull S3 backup connections from ee-api. This export is consumed by the
    //bulker service — there is no signed-in user — so it authenticates with
    //the static service token.
    const url = `${getEeConnection().host}api/s3-connections`;
    try {
      const backupConnections: unknown = await rpc(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...serviceTokenHeaders(),
        },
      });
      if (!Array.isArray(backupConnections)) {
        throw new Error(`Expected an array of backup connections, got: ${typeof backupConnections}`);
      }
      for (const conn of backupConnections) {
        if (needComma) {
          writer.write(",");
        }
        writer.write(JSON.stringify(conn));
        needComma = true;
      }
    } catch (e) {
      getLog()
        .atError()
        .withCause(e)
        .log(`System error: Failed to export backup connections for 'bulker-connections': ${getErrorMessage(e)}`);
    }
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
        const data = LinkData.parse(data_);
        if (data.disabled) {
          continue; // skip disabled connections
        }
        const destinationType = ObjectConfig.parse(to.config).destinationType;
        const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
        if (!coreDestinationType) {
          getLog().atError().log(`Unknown destination type: ${destinationType} for connection ${id}`);
        }
        const credentials = omit(asRecord(to.config), "destinationType", "type", "name");
        payload = JSON.stringify({
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
        });
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
          payload = JSON.stringify({
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
          });
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
      payload = JSON.stringify({
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
      });
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
          backupEnabled: isEEAvailable() && !(obj.workspace.featuresEnabled || []).includes("nobackup"),
          throttle: throttlePercent,
          shard: shardNumber,
          // opt-in per workspace (Settings → Capture HTTP headers): ingest stores
          // request headers in event context.headers (AI agent / bot detection)
          captureHeaders: (obj.workspace.featuresEnabled || []).includes("captureHeaders"),
          destinations: [
            ...obj.toLinks
              .filter(l => !l.deleted && l.type === "push" && !LinkData.parse(l.data).disabled && !l.to.deleted)
              .map(l => {
                const toConfig = ObjectConfig.parse(l.to.config);
                return {
                  id: l.to.id,
                  connectionId: l.id,
                  destinationType: toConfig.destinationType,
                  name: toConfig.name,
                  credentials: omit(toConfig, "destinationType", "type", "name"),
                  options: {
                    ...LinkData.parse(l.data),
                    functionsServer: selectFunctionsServer(
                      functionsServers,
                      obj.workspace.id,
                      l.id,
                      functionsClassFunc(obj.workspace)
                    ),
                  },
                };
              }),
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
                  (select max("updatedAt") from newjitsu."Workspace")
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
