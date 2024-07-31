import { createRoute, verifyAccess } from "../../../../lib/api";
import { z } from "zod";
import { getServerLog } from "../../../../lib/server/log";
import { requireDefined } from "juava";
import { createClient } from "@clickhouse/client";
import { ClickhouseCredentials } from "../../../../lib/schema/destinations";
import { Parser } from "node-sql-parser";
import { db } from "../../../../lib/server/db";

const SQLQueryDefaultLimit = 50;
const log = getServerLog("sql-query");

export const getClickhouseClient = (workspaceId: string, cred: ClickhouseCredentials) => {
  const [host, port = "8443"] = cred.hosts[0].split(":");
  const url = `https://${host}:${port}/`;
  log.atDebug().log(`Connecting to ${url} with ${cred.username}`);
  return createClient({
    url: url,
    database: cred.database,
    username: cred.username,
    password: cred.password,
  });
};

export const columnType = z.object({ name: z.string(), type: z.string() });
export type columnType = z.infer<typeof columnType>;

const resultType = z.object({
  meta: z.array(columnType),
  data: z.array(z.object({}).passthrough()),
  rows: z.number(),
  limit: z.number(),
  offset: z.number(),
  statistics: z.object({}).passthrough(),
});

export type SQLResultType = z.infer<typeof resultType>;

export default createRoute()
  .POST({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      destinationId: z.string(),
    }),
    body: z.object({
      query: z.string(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query, body }) => {
    const { workspaceId, destinationId } = query;
    await verifyAccess(user, workspaceId);
    const destination = requireDefined(
      await db.prisma().configurationObject.findFirst({
        where: { id: destinationId, workspaceId: workspaceId, type: "destination", deleted: false },
      }),
      `Destination ${destinationId} not found`
    );
    const cred = ClickhouseCredentials.parse(destination.config);
    if (!destination?.config?.["provisioned"] && cred.protocol !== "https") {
      throw new Error(
        `At this moment, queries are only supported for HTTPS ClickHouse. Destination ${destinationId} uses ${cred.protocol} `
      );
    }
    const clickhouse = getClickhouseClient(workspaceId, cred);

    const adjustedQuery = adjustQuery(body.query, body.limit || SQLQueryDefaultLimit, body.offset);

    const resultSet = await clickhouse.query({
      query: adjustedQuery.query,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
    let index = adjustedQuery.offset + 1;
    const result = (await resultSet.json()) as any;
    result.data = result.data.map(row => {
      return { "#": index++, ...row };
    });
    result.meta = [{ name: "#", type: "UInt64" }, ...result.meta];
    return { ...result, limit: adjustedQuery.limit, offset: adjustedQuery.offset };
  })
  .GET({
    description: "List all destinations that support SQL queries for a given workspace",
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      destinationId: z.string().optional(),
    }),
    result: z.record(z.object({ destinationId: z.string(), name: z.string(), supportQueries: z.boolean() })),
  })
  .handler(async ({ user, query, body }) => {
    const { workspaceId, destinationId } = query;
    await verifyAccess(user, workspaceId);
    const destinations = await db.prisma().configurationObject.findMany({
      where: { workspaceId: workspaceId, type: "destination", deleted: false, id: destinationId },
    });
    const result = {};
    for (const destination of destinations) {
      if (
        destination.config?.["destinationType"] === "clickhouse" &&
        (ClickhouseCredentials.parse(destination.config).protocol === "https" || !!destination.config?.["provisioned"])
      ) {
        result[destination.id] = {
          destinationId: destination.id,
          name: (destination?.config as any).name,
          supportQueries: true,
        };
      } else {
        result[destination.id] = {
          destinationId: destination.id,
          name: (destination?.config as any).name,
          supportQueries: false,
        };
      }
    }
    return result;
  })
  .toNextApiHandler();

function adjustQuery(sql: string, limit: number, offset?: number) {
  const parser = new Parser();
  let parsed = parser.astify(sql);
  if (Array.isArray(parsed)) {
    if (parsed.length > 1) {
      throw new Error("Only single query is allowed");
    }
    parsed = parsed[0];
  }
  if (parsed.type !== "select") {
    throw new Error("Only SELECT queries are allowed");
  }
  parser.whiteListCheck(sql, ["select::(.*)::(.*)"], { type: "table" });

  let userLimit = SQLQueryDefaultLimit;
  let userOffset = 0;

  const limitNode = (parsed["limit"] || {}) as any;
  if (Array.isArray(limitNode.value) && limitNode.value.length > 0) {
    userLimit = limitNode.value[0].value;
    if (limitNode.seperator === "offset" && limitNode.value.length > 1) {
      userOffset = limitNode.value[1].value;
    }
  }
  parsed["limit"] = {
    seperator: "offset",
    value: [
      { type: "number", value: Math.min(userLimit, limit) },
      { type: "number", value: offset ?? userOffset },
    ],
  };
  const queryWithLimits = parser.sqlify(parsed);
  log.atDebug().log("adjusted query: ", queryWithLimits);
  return { query: queryWithLimits, limit: Math.min(userLimit, limit), offset: offset ?? userOffset };
}
