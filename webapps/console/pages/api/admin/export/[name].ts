import { createRoute, verifyAdmin } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { getErrorMessage, getLog, requireDefined, rpc } from "juava";
import { z } from "zod";
import { getCoreDestinationTypeNonStrict } from "../../../../lib/schema/destinations";
import pick from "lodash/pick";
import { createJwt, getEeConnection, isEEAvailable } from "../../../../lib/server/ee";
import omit from "lodash/omit";

interface Writer {
  write(data: string): void;
}

export type Export = {
  name: string;
  lastModified: () => Promise<Date | undefined>;
  data: (writer: Writer) => Promise<void>;
};

const batchSize = 1000;

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
    name: "bulker",
    lastModified: getLastUpdated,
    data: async writer => {
      writer.write("[");

      let lastId: string | undefined = undefined;
      let needComma = false;
      while (true) {
        const objects = await db.prisma().configurationObjectLink.findMany({
          where: { deleted: false },
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
          console.log(to.config);
          if (getCoreDestinationTypeNonStrict(destinationType)?.usesBulker) {
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
                options:
                  from.config.type === "stream"
                    ? pick(data, "mode", "frequency", "primaryKey", "timestampColumn")
                    : undefined,
                updatedAt: dateMax(updatedAt, from.updatedAt, to.updatedAt),
                credentials: to.config,
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
    name: "streams-with-destinations",
    lastModified: getLastUpdated,
    data: async writer => {
      writer.write("[");
      let lastId: string | undefined = undefined;
      let needComma = false;
      while (true) {
        const objects = await db.prisma().configurationObject.findMany({
          where: { deleted: false, type: "stream" },
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
              },
              destinations: obj.toLinks
                .filter(l => !l.deleted && l.type === "push")
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

export default createRoute()
  .GET({
    auth: true,
    streaming: true,
    query: z.object({
      name: z.string(),
    }),
  })
  .handler(async ({ user, req, res, query }) => {
    await verifyAdmin(user);
    const exp = requireDefined(exportsMap[query.name], `Export ${query.name} not found`);
    let ifModifiedSince: Date | undefined = undefined;
    const ifModifiedSinceStr = req.headers["if-modified-since"];
    try {
      ifModifiedSince = ifModifiedSinceStr ? new Date(ifModifiedSinceStr) : undefined;
    } catch (e) {
      getLog()
        .atWarn()
        .withCause(e)
        .log(`Error parsing if-modified-since header '${ifModifiedSinceStr}': ${getErrorMessage(e)}`);
    }
    const lastModified = await exp.lastModified();
    if (ifModifiedSince && lastModified && ifModifiedSince.getTime() >= lastModified.getTime()) {
      res.setHeader("Last-Modified", lastModified.toUTCString());
      res.status(304).end();
      return;
    } else {
      if (lastModified) {
        res.setHeader("Last-Modified", lastModified.toUTCString());
      }
      res.setHeader("Content-Type", "application/json");
      await exp.data(res);
      res.end();
    }
  })
  .toNextApiHandler();
