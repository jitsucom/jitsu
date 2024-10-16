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

interface Writer {
  write(data: string): void;
}

export type Export = {
  name: string;
  lastModified: () => Promise<Date | undefined>;
  data: (writer: Writer) => Promise<void>;
};

const batchSize = 1000;

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
          where: { deleted: false, workspace: { deleted: false }, from: { deleted: false }, to: { deleted: false } },
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
            writer.write(
              JSON.stringify({
                __debug: {
                  workspace: { id: workspace.id, name: workspace.slug },
                },
                id: id,
                type: destinationType,
                options: data,
                updatedAt: dateMax(updatedAt, to.updatedAt),
                credentials: omit(to.config, "destinationType", "type", "name"),
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
        const objects = await db.prisma().profileBuilder.findMany({
          where: { deleted: false, workspace: { deleted: false }, destination: { deleted: false } },
          include: { destination: true, workspace: true },
          take: batchSize,
          cursor: lastId ? { id: lastId } : undefined,
          orderBy: { id: "asc" },
        });
        if (objects.length == 0) {
          break;
        }
        getLog().atDebug().log(`Got batch of ${objects.length} profilebuilder objects for bulker export`);
        lastId = objects[objects.length - 1].id;
        for (const { id, updatedAt, workspace, destination, connectionOptions, ...pb } of objects) {
          if (!destination) {
            return;
          }
          const destinationType = destination.config.destinationType;
          const coreDestinationType = getCoreDestinationTypeNonStrict(destinationType);
          if (coreDestinationType?.usesBulker || coreDestinationType?.hybrid) {
            if (needComma) {
              writer.write(",");
            }
            const schema = {
              name: "profiles",
              fields: [
                {
                  name: "user_id",
                  type: 4, //string. See bulker's DataType
                },
                {
                  name: "traits",
                  type: 6, // json
                },
                {
                  name: "custom_properties",
                  type: 6, // json
                },
                {
                  name: "updated_at",
                  type: 5, // timestamp
                },
              ],
            };
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
                  ...connectionOptions,
                  deduplicate: true,
                  primaryKey: "user_id",
                  schema: JSON.stringify(schema),
                },
                updatedAt: dateMax(updatedAt, destination.updatedAt),
                credentials: omit(destination.config, "destinationType", "type", "name"),
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
              destinationId: to.id,
              usesBulker: !!coreDestinationType?.usesBulker,
              options: {
                ...data,
                ...((workspace.featuresEnabled ?? []).includes("nofetchlogs") ? { fetchLogLevel: "debug" } : {}),
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
              codeHash: hash(row.config?.code),
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
                ...obj.config,
                workspaceId: obj.workspace.id,
              },
              backupEnabled: isEEAvailable() && !(obj.workspace.featuresEnabled || []).includes("nobackup"),
              throttle: throttlePercent,
              shard: shardNumber,
              destinations: obj.toLinks
                .filter(l => !l.deleted && l.type === "push" && !l.to.deleted)
                .map(l => ({
                  id: l.to.id,
                  connectionId: l.id,
                  destinationType: l.to.config.destinationType,
                  name: l.to.config.name,
                  credentials: omit(l.to.config, "destinationType", "type", "name"),
                  options: l.data,
                })),
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
            profileBuilders: { some: { NOT: { id: undefined } } },
          },
          include: { profileBuilders: { include: { functions: true } } },
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
