import { createRoute, verifyAdmin } from "../../../../../lib/api";
import { db } from "../../../../../lib/server/db";
import { getErrorMessage, getLog, hash as juavaHash, requireDefined, rpc } from "juava";
import { z } from "zod";
import { getCoreDestinationTypeNonStrict } from "../../../../../lib/schema/destinations";
import { createJwt, getEeConnection, isEEAvailable } from "../../../../../lib/server/ee";
import omit from "lodash/omit";
import { NextApiRequest } from "next";
import hash from "object-hash";
import { default as stableHash } from "stable-hash";
import { WorkspaceDbModel } from "../../../../../prisma/schema";
import pick from "lodash/pick";
import { ProfileBuilder } from "@jitsu/core-functions";

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
const clickhouseUploadS3Bucket = process.env.CLICKHOUSE_UPLOAD_S3_BUCKET;
const s3Region = process.env.S3_REGION;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const clickhouseS3Configured = clickhouseUploadS3Bucket && s3Region && s3AccessKeyId && s3SecretAccessKey;

const safeLastModified = new Date(2024, 0, 1, 0, 0, 0, 0);

function dateMax(...dates: (Date | undefined)[]): Date | undefined {
  return dates.reduce((acc, d) => (d && (!acc || d.getTime() > acc.getTime()) ? d : acc), undefined);
}

async function getLastUpdated(): Promise<Date | undefined> {
  return (
    (await db.prisma().$queryRaw`
        select
            greatest(
                    (select max("updatedAt") from newjitsu."ConfigurationObjectLink"),
                    (select max("updatedAt") from newjitsu."ProfileBuilder"),
                    (select max("updatedAt") from newjitsu."ConfigurationObject"),
                    (select max("updatedAt") from newjitsu."Workspace")
            ) as "last_updated"`) as any
  )[0]["last_updated"];
}

const exports: Export[] = [
  {
    name: "bulker-connections",
    lastModified: getLastUpdated,
    data: async writer => {
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
              if (credentials.loadAsJson && !credentials.provisioned && clickhouseS3Configured) {
                credentials.s3Region = s3Region;
                credentials.s3AccessKeyId = s3AccessKeyId;
                credentials.s3SecretAccessKey = s3SecretAccessKey;
                credentials.s3Bucket = clickhouseUploadS3Bucket;
                credentials.s3UsePresignedURL = true;
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
        const eeAuthToken = createJwt(
          "admin-service-account@jitsu.com",
          "admin-service-account@jitsu.com",
          "$all",
          60
        ).jwt;
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
    },
  },
  {
    name: "rotor-connections",
    lastModified: getLastUpdated,
    data: async writer => {
      writer.write("[");

      let lastId: string | undefined = undefined;
      let needComma = false;
      const profileBuilders = await db.prisma().profileBuilder.findMany({
        where: {
          deleted: false,
          workspace: { deleted: false },
          version: { gt: 0 },
        },
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
                ...((workspace.featuresEnabled ?? []).includes("nofetchlogs") ? { fetchLogLevel: "debug" } : {}),
                ...((workspace.featuresEnabled ?? []).includes("fastFunctions") ? { fastFunctions: true } : {}),
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
          eventsCollectionName: `profiles-raw-${pb.workspaceId}-${pb.id}`,
          traitsCollectionName: `profiles-traits-${pb.workspaceId}-${pb.id}`,
        };
        const opts = {
          functionsEnv: (pb.connectionOptions ?? ({} as any)).variables,
          functions: [
            {
              functionId: "builtin.transformation.user-recognition",
            },
            ...((pb.connectionOptions ?? ({} as any)).functions || []),
          ],
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
    },
  },
  {
    name: "functions",
    lastModified: getLastUpdated,
    data: async writer => {
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
    },
  },
  {
    name: "streams-with-destinations",
    lastModified: getLastUpdated,
    data: async writer => {
      const activeWorkspaces = new Set<string>();
      try {
        const rows = await db.pgPool()
          .query(`with customers as (select obj -> 'customer' ->> 'id'         as customer_id,
                                            obj -> 'subscription' ->> 'status' as status
                                     from newjitsuee.kvstore
                                     where namespace = 'stripe-customer-info'
                                     order by status),
                       workspaces
                         as (select id as workspace_id, obj ->> 'stripeCustomerId' as customer_id
                             from newjitsuee.kvstore
                             where namespace = 'stripe-settings')
                  select workspace_id
                  from workspaces w
                         right join customers cus on cus.customer_id = w.customer_id
                  where status = 'active'`);
        for (const row of rows.rows) {
          activeWorkspaces.add(row.workspace_id);
        }
        getLog().atInfo().log(`Active workspaces: ${activeWorkspaces.size}`);
      } catch (error) {}
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
          const throttlePercent = !activeWorkspaces.has(obj.workspace.id)
            ? getNumericOption("throttle", obj.workspace)
            : undefined;
          const shardNumber = getNumericOption("shard", obj.workspace);
          const classicKeys = classicKeysMap[obj.id] || ({} as ClassicKeys);
          writer.write(
            JSON.stringify({
              __debug: {
                workspace: { id: obj.workspace.id, name: obj.workspace.slug },
              },
              id: obj.id,
              stream: {
                ...omit(
                  obj,
                  "type",
                  "workspaceId",
                  "config",
                  "toLinks",
                  "deleted",
                  "createdAt",
                  "updatedAt",
                  "workspace"
                ),
                ...{
                  ...obj.config,
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
                  .filter(l => !l.deleted && l.type === "push" && !l.to.deleted)
                  .map(l => ({
                    id: l.to.id,
                    connectionId: l.id,
                    destinationType: (l.to.config ?? {}).destinationType,
                    name: (l.to.config ?? {}).name,
                    credentials: omit(l.to.config, "destinationType", "type", "name"),
                    options: l.data,
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
    },
  },
  {
    name: "workspaces-with-profiles",
    lastModified: async () => {
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
    },
    data: async writer => {
      writer.write("[");
      let lastId: string | undefined = undefined;
      let needComma = false;
      while (true) {
        const objects = await db.prisma().workspace.findMany({
          where: {
            deleted: false,
            profileBuilders: { some: { version: { gt: 0 } } },
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
    },
  },
  {
    name: "syncs-debug",
    lastModified: getLastUpdated,
    data: async writer => {
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
    },
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
  dateOnly: z.coerce.boolean().optional().default(false),
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
