import { createRoute, verifyAdmin } from "../../../../../lib/api";
import { db } from "../../../../../lib/server/db";
import { getErrorMessage, getLog, hash as juavaHash, isTruish, requireDefined, rpc } from "juava";
import { z } from "zod";
import { getCoreDestinationTypeNonStrict } from "../../../../../lib/schema/destinations";
import { createJwt, getEeConnection, isEEAvailable } from "../../../../../lib/server/ee";
import omit from "lodash/omit";
import { NextApiRequest } from "next";
import hash from "object-hash";
import { default as stableHash } from "stable-hash";
import { WorkspaceDbModel, FunctionsServerDbModel } from "../../../../../prisma/schema";
import pick from "lodash/pick";
import { ProfileBuilder } from "@jitsu/destination-functions";
import { getServerEnv } from "../../../../../lib/server/serverEnv";

const serverEnv = getServerEnv();
const defaultFunctionsClass = serverEnv.DEFAULT_FUNCTIONS_CLASS;
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

function dateMax(...dates: (Date | undefined)[]): Date | undefined {
  return dates.reduce((acc, d) => (d && (!acc || d.getTime() > acc.getTime()) ? d : acc), undefined);
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

function selectFunctionsServer(
  functionsServers: Map<string, FunctionsServerDbModel>,
  workspaceId: string,
  conId: string,
  functionsClass: string
) {
  if (functionsClass === "legacy") {
    return {
      status: "legacy",
    };
  }
  let functionsServer:
    | {
        deploymentId: string;
        status: "functions" | "empty" | "missing";
      }
    | undefined = undefined;
  for (const pr of functionsClassesPriorities[functionsClass]) {
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
  return (
    (await db.prisma().$queryRaw`
        select
            greatest(
                    (select max("updatedAt") from newjitsu."ConfigurationObjectLink"),
                    (select max("updatedAt") from newjitsu."ProfileBuilder"),
                    (select max("updatedAt") from newjitsu."ConfigurationObject"),
                    (select max("updatedAt") from newjitsu."FunctionsServer"),
                    (select max("updatedAt") from newjitsu."Workspace")
            ) as "last_updated"`) as any
  )[0]["last_updated"];
}

async function exportBulkerConnections(writer: Writer) {
  writer.write("[");

  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects = await db.prisma().configurationObjectLink.findMany({
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
    for (const { data, from, id, to, updatedAt, workspace } of objects) {
      if (data?.disabled) {
        continue; // skip disabled connections
      }
      const destinationType = to.config.destinationType;
      const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
      if (coreDestinationType?.usesBulker || coreDestinationType?.hybrid) {
        if (needComma) {
          writer.write(",");
        }
        const credentials = omit(to.config, "destinationType", "type", "name");
        if (destinationType === "clickhouse") {
          if ((data as any).clickhouseSettings) {
            const extraParams = Object.fromEntries(
              ((data as any).clickhouseSettings as string)
                .split("\n")
                .filter(s => s.includes("="))
                .map(s => s.split("="))
                .map(([k, v]) => [k.trim(), v.trim()])
            );
            credentials.parameters = { ...(credentials.parameters || {}), ...extraParams };
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
        writer.write(
          JSON.stringify({
            __debug: {
              workspace: { id: workspace.id, name: workspace.slug },
            },
            id: id,
            type: destinationType,
            options: omit(data as any, "clickhouseSettings"),
            updatedAt: dateMax(updatedAt, to.updatedAt),
            credentials: credentials,
          })
        );
        needComma = true;
      }
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  lastId = undefined;
  while (true) {
    const objects = await db.prisma().configurationObject.findMany({
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
      const destinationType = config.destinationType;
      const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
      if (coreDestinationType?.usesBulker || coreDestinationType?.hybrid) {
        if (needComma) {
          writer.write(",");
        }
        writer.write(
          JSON.stringify({
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
            credentials: omit(config, "destinationType", "type", "name"),
          })
        );
        needComma = true;
      }
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  if (isEEAvailable()) {
    //stream additional connections from ee
    const eeAuthToken = createJwt("admin-service-account@jitsu.com", "admin-service-account@jitsu.com", "$all", 60).jwt;
    const url = `${getEeConnection().host}api/s3-connections`;
    try {
      const backupConnections = await rpc(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${eeAuthToken}`,
        },
      });
      for (const conn of backupConnections) {
        if (needComma) {
          writer.write(",");
        }
        writer.write(JSON.stringify(conn));
        needComma = true;
      }
    } catch (e) {
      console.error("Error getting backup connections", e);
    }
  }

  writer.write("]");
}

async function exportRotorConnections(writer: Writer) {
  const workspacesWithClasses = await functionsClassByWorkspace();
  const functionsClassFunc = (workspace: any) =>
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
    const objects = await db.prisma().configurationObjectLink.findMany({
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
    for (const { data, from, id, to, updatedAt, workspace } of objects) {
      if (data?.disabled) {
        continue; // skip disabled connections
      }
      const destinationType = to.config.destinationType;
      const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
      if (!coreDestinationType) {
        getLog().atError().log(`Unknown destination type: ${destinationType} for connection ${id}`);
      }
      if (needComma) {
        writer.write(",");
      }
      writer.write(
        JSON.stringify({
          __debug: {
            workspace: { id: workspace.id, name: workspace.slug },
          },
          id: id,
          type: destinationType,
          workspaceId: workspace.id,
          streamId: from.id,
          streamName: from.config?.name,
          destinationId: to.id,
          usesBulker: !!coreDestinationType?.usesBulker,
          options: {
            ...data,
            ...((workspace.featuresEnabled ?? []).includes("nofetchlogs") &&
            data?.functionsEnv?.FETCH_LOGS_ENABLED !== "true"
              ? { fetchLogLevel: "debug" }
              : {}),
            ...((workspace.featuresEnabled ?? []).includes("fastFunctions") ? { fastFunctions: true } : {}),
            //TODO: remove after migration
            functionsClasses: extractFunctionsClasses(workspace.featuresEnabled ?? []),
            functionsServer: selectFunctionsServer(functionsServers, workspace.id, id, functionsClassFunc(workspace)),
            workspaceUpdatedAt: workspace.updatedAt,
          },
          optionsHash: hash(data),
          updatedAt: dateMax(updatedAt, to.updatedAt),
          credentials: omit(to.config, "destinationType", "type", "name"),
          credentialsHash: hash(omit(to.config, "destinationType", "type", "name")),
        })
      );
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  lastId = undefined;
  while (true) {
    const objects = await db.prisma().configurationObject.findMany({
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
      const destinationType = config?.destinationType;
      const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
      if (coreDestinationType?.usesBulker || coreDestinationType?.hybrid) {
        if (needComma) {
          writer.write(",");
        }
        writer.write(
          JSON.stringify({
            id: id,
            type: destinationType,
            workspaceId: workspace.id,
            streamId: id,
            streamName: config?.name,
            destinationId: id,
            usesBulker: !!coreDestinationType?.usesBulker,
            updatedAt: updatedAt,
            credentials: omit(config, "destinationType", "type", "name"),
            credentialsHash: hash(omit(config, "destinationType", "type", "name")),
          })
        );
        needComma = true;
      }
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  for (const pb of profileBuilders) {
    if (needComma) {
      writer.write(",");
    }
    const cred = {
      ...(pb.intermediateStorageCredentials ?? ({} as any)),
      profileWindowDays: (pb.connectionOptions ?? ({} as any)).profileWindow,
      profileBuilderId: pb.id,
      eventsCollectionName: `profiles-raw-${pb.workspace.id}-${pb.id}`,
      traitsCollectionName: `profiles-traits-${pb.workspace.id}-${pb.id}`,
    };
    const opts = {
      functionsEnv: (pb.connectionOptions ?? ({} as any)).variables,
      functions: [
        {
          functionId: "builtin.transformation.user-recognition",
        },
        ...((pb.connectionOptions ?? ({} as any)).functions || []),
      ],
      functionsServer: selectFunctionsServer(
        functionsServers,
        pb.workspace.id,
        pb.id,
        functionsClassFunc(pb.workspace)
      ),
      workspaceUpdatedAt: pb.workspace.updatedAt,
    };
    writer.write(
      JSON.stringify({
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
        optionsHash: hash(opts),
        updatedAt: pb.updatedAt,
        credentials: cred,
        credentialsHash: hash(cred),
      })
    );
    needComma = true;
  }
  writer.write("]");
}

async function exportFunctions(writer: Writer) {
  writer.write("[");

  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects = await db.prisma().configurationObject.findMany({
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
      if (needComma) {
        writer.write(",");
      }
      writer.write(
        JSON.stringify({
          ...omit(row, "deleted", "config"),
          ...row.config,
          codeHash: hash(row.config?.code || row.config?.draft || ""),
        })
      );
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
  const functionsClassFunc = (workspace: any) =>
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
    const name = (domain.config as any).name;
    if (!name.includes("*")) {
      const d = domainsMap.get(domain.workspaceId) || [];
      domainsMap.set(domain.workspaceId, [...d, (domain.config as any).name]);
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
    .filter(c => c.config && c.config["value"])
    .flatMap(c => c.config!["value"].split("\n"))
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
  const pbMap = new Map<string, ProfileBuilder[]>();
  for (const pb of profileBuilders) {
    const pbs = pbMap.get(pb.workspaceId) || [];
    pbMap.set(pb.workspaceId, [...pbs, pb as unknown as ProfileBuilder]);
  }

  writer.write("[");
  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects = await db.prisma().configurationObject.findMany({
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
      if (needComma) {
        writer.write(",");
      }
      const throttlePercent =
        workspacesWithClasses.get(obj.workspace.id)?.status !== "active"
          ? getNumericOption("throttle", obj.workspace)
          : undefined;
      const shardNumber = obj.config.shard || getNumericOption("shard", obj.workspace);
      const classicKeys = classicKeysMap[obj.id] || ({} as ClassicKeys);
      writer.write(
        JSON.stringify({
          __debug: {
            workspace: { id: obj.workspace.id, name: obj.workspace.slug },
          },
          id: obj.id,
          stream: {
            ...omit(obj, "type", "workspaceId", "config", "toLinks", "deleted", "createdAt", "updatedAt", "workspace"),
            ...{
              ...omit(obj.config, "shard"),
              publicKeys: [classicKeys.publicKeys ?? [], obj.config.publicKeys ?? []].flat(),
              privateKeys: [classicKeys.privateKeys ?? [], obj.config.privateKeys ?? []].flat(),
              domains: [...new Set([...(domainsMap.get(obj.workspace.id) ?? []), ...(obj.config.domains ?? [])])],
            },
            workspaceId: obj.workspace.id,
          },
          backupEnabled: isEEAvailable() && !(obj.workspace.featuresEnabled || []).includes("nobackup"),
          throttle: throttlePercent,
          shard: shardNumber,
          destinations: [
            ...obj.toLinks
              .filter(l => !l.deleted && l.type === "push" && !l.data?.disabled && !l.to.deleted)
              .map(l => ({
                id: l.to.id,
                connectionId: l.id,
                destinationType: (l.to.config ?? {}).destinationType,
                name: (l.to.config ?? {}).name,
                credentials: omit(l.to.config, "destinationType", "type", "name"),
                options: {
                  ...(l.data ?? {}),
                  functionsClasses: extractFunctionsClasses(obj.workspace.featuresEnabled ?? []),
                  functionsServer: selectFunctionsServer(
                    functionsServers,
                    obj.workspace.id,
                    l.id,
                    functionsClassFunc(obj.workspace)
                  ),
                },
              })),
            ...(pbMap.get(obj.workspace.id) ?? []).map(pb => ({
              id: pb.id,
              connectionId: pb.id,
              destinationType: "profiles",
              name: "profiles",
              credentials: {
                ...pb.intermediateStorageCredentials,
                profileWindowDays: pb.connectionOptions.profileWindow,
                profileBuilderId: pb.id,
                eventsCollectionName: `profiles-raw-${obj.workspace.id}-${pb.id}`,
                traitsCollectionName: `profiles-traits-${obj.workspace.id}-${pb.id}`,
              },
              options: {
                functionsEnv: pb.connectionOptions?.variables,
                functions: pb.connectionOptions?.functions,
              },
            })),
          ],
        })
      );
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  writer.write("]");
}

async function exportWorkspacesLastModified(): Promise<Date | undefined> {
  const lastUpdated = (
    (await db.prisma().$queryRaw`select max("updatedAt") as "last_updated" from newjitsu."Workspace"`) as any
  )[0]["last_updated"] as Date;
  // force refresh every 5 minute to actualize possible subscription status changes or expirations
  const forceRefreshEveryMs = 5 * 60 * 1000;
  if (lastUpdated.getTime() < Date.now() - forceRefreshEveryMs) {
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
  const rows = await db.pgPool().query(`with customers as (select obj -> 'customer' ->> 'id'         as customer_id,
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
    const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
    const status = row.status;
    if (status === "active" || status === "trialing") {
      workspacesWithClasses.set(row.id, { class: "dedicated", status: "active" });
    } else if (status === "canceled") {
      if (row.period_end.getTime() > now) {
        workspacesWithClasses.set(row.id, { class: "dedicated", status: "active" });
      }
    } else if (status === "past_due" || status === "unpaid") {
      if (row.period_end.getTime() + oneMonthMs > now) {
        // keep dedicated instance for 30 days of past due subscription
        workspacesWithClasses.set(row.id, { class: "dedicated", status });
      } else if (row.period_end.getTime() > now) {
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
    const objects = await db.prisma().workspace.findMany({
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
      if (needComma) {
        writer.write(",");
      }
      row.featuresEnabled = addFunctionsClass(row.featuresEnabled ?? [], functionsClassFunc(row.id));
      writer.write(JSON.stringify(row));
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  writer.write("]");
}

async function exportWorkspacesWithProfilesLastModified(): Promise<Date | undefined> {
  return (
    (await db.prisma().$queryRaw`
            select
              greatest(
                  (select max("updatedAt") from newjitsu."ConfigurationObject" where type='function'),
                  (select max("updatedAt") from newjitsu."ProfileBuilder"),
                  (select max("updatedAt") from newjitsu."ProfileBuilderFunction"),
                  (select max("updatedAt") from newjitsu."Workspace")
              ) as "last_updated"`) as any
  )[0]["last_updated"];
}

async function exportWorkspacesWithProfiles(writer: Writer) {
  writer.write("[");
  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects = await db.prisma().workspace.findMany({
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
      if (needComma) {
        writer.write(",");
      }
      row.profileBuilders = row.profileBuilders
        .filter(pb => pb.version > 0)
        .map(pb => {
          pb.functions = pb.functions.map(f => {
            return {
              ...omit(f.function, "config"),
              ...f.function.config,
            };
          });
          return pb;
        });
      writer.write(JSON.stringify(row));
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  writer.write("]");
}

async function exportSyncsDebug(writer: Writer) {
  writer.write("[");

  let lastId: string | undefined = undefined;
  let needComma = false;
  while (true) {
    const objects = await db.prisma().configurationObjectLink.findMany({
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
    getLog().atDebug().log(`Got batch of ${objects.length} objects for bulker export`);
    lastId = objects[objects.length - 1].id;
    for (const { data, from, id, to, updatedAt, workspace } of objects) {
      const destinationType = to.config.destinationType;
      const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
      if (!coreDestinationType) {
        getLog().atError().log(`Unknown destination type: ${destinationType} for connection ${id}`);
      }
      if (needComma) {
        writer.write(",");
      }
      const h = juavaHash("md5", stableHash(from.config.credentials));
      const storageKey = `${workspace.id}_${from.id}_${h}`;
      writer.write(
        JSON.stringify({
          id: id,
          type: destinationType,
          workspaceId: workspace.id,
          streamId: from.id,
          destinationId: to.id,
          usesBulker: !!coreDestinationType?.usesBulker,
          options: {
            ...pick(data, "storageKey"),
            versionHash: storageKey,
          },
          updatedAt: dateMax(updatedAt, to.updatedAt),
        })
      );
      needComma = true;
    }
    if (objects.length < batchSize) {
      break;
    }
  }
  writer.write("]");
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
    name: "syncs-debug",
    lastModified: getLastUpdated,
    data: exportSyncsDebug,
  },
];

const exportsMap = exports.reduce((acc, e) => ({ ...acc, [e.name]: e }), {});

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

function getNumericOption(name: string, workspace: z.infer<typeof WorkspaceDbModel>, defaultValue?: number) {
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
      await exp.data(res);
    }
    res.end();
  })
  .toNextApiHandler();
