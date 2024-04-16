import { createRoute, verifyAdmin } from "../../../../../lib/api";
import { db } from "../../../../../lib/server/db";
import { getErrorMessage, getLog, requireDefined, rpc } from "juava";
import { z } from "zod";
import { getCoreDestinationTypeNonStrict } from "../../../../../lib/schema/destinations";
import { createJwt, getEeConnection, isEEAvailable } from "../../../../../lib/server/ee";
import omit from "lodash/omit";
import { NextApiRequest } from "next";
import hash from "object-hash";

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
          if (getCoreDestinationTypeNonStrict(destinationType)?.usesBulker || data?.mode === "batch") {
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
              options: data,
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
              backupEnabled: !(obj.workspace.featuresEnabled || []).includes("nobackup"),
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
