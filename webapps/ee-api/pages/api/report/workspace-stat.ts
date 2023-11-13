import type { NextApiRequest, NextApiResponse } from "next";
import { getLog, namedParameters, SqlQueryParameters, unrollParams } from "juava";
import { withErrorHandler } from "../../../lib/error-handler";
import { auth } from "../../../lib/auth";
import { clickhouse, pg } from "../../../lib/services";
import * as PG from "pg";
import { getServerLog } from "../../../lib/log";

const log = getServerLog("/api/report");

const workspaceStatSql = require("../../../lib/sql/workspace-info.sql").default;

export type ISODate = string;

export type WorkspaceReportRow = {
  period: ISODate;
  workspaceId: string;
  events: number;
};

export type ReportParams = {
  workspaceId?: string;
  start: ISODate;
  end: ISODate;
  granularity: "day";
};

function removeUndefined<T>(obj: Record<string, T | undefined>): Record<string, T> {
  const res: Record<string, T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      res[key] = value;
    }
  }
  return res;
}

function isoDateTOClickhouse(date: ISODate): string {
  return date.replace("T", " ").replace("Z", "").split(".")[0];
}

async function getPostgresPart({ granularity, start, end, workspaceId }: ReportParams): Promise<WorkspaceReportRow[]> {
  const sql = `select
                 obj."workspaceId" as "workspaceId",
                 date_trunc(:granularity, (m.timestamp::TIMESTAMPTZ)) as period,
                 sum(m.value) as events
               from newjitsuee.bulker_metrics m
                    left join newjitsu."ConfigurationObjectLink" obj
                              on obj."id" = m."destinationId"
               where m.metric_name = 'bulkerapp_ingest_messages' and m.status = 'success' and m.timestamp <= '2023-07-28T00:00:00Z' and ${
                 workspaceId ? 'obj."workspaceId" = :workspaceId and' : ""
               } date_trunc(:granularity, "timestamp") >= date_trunc(:granularity, :start::timestamp) and
                 date_trunc(:granularity, "timestamp") <= date_trunc(:granularity, :end::timestamp)
               group by period, "workspaceId"
               order by period, "workspaceId" desc;;
  `;
  const params = removeUndefined({ start, end, granularity, workspaceId });
  const { query, values } = namedParameters(sql, params);
  return await pg.query({ text: query, values }).then(res => {
    return res.rows;
  });
}

async function getClickhousePart({
  granularity,
  start,
  end,
  workspaceId,
}: ReportParams): Promise<WorkspaceReportRow[]> {
  const timer = Date.now();
  const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || "newjitsu_metrics";
  const query = `select
                   date_trunc('${granularity}', timestamp) as period,
                   workspaceId as "workspaceId",
                   uniqMerge(count) as events
                 from ${metricsSchema}.mv_active_incoming
                 where
                   timestamp >= toDateTime('2023-07-28 00:00:00', 'UTC') and
                   timestamp >= toDateTime({start :String}, 'UTC') and
                   timestamp <= toDateTime({end :String}, 'UTC') ${
                     workspaceId ? "and workspaceId = {workspaceId:String}" : ""
                   }
                 group by period, workspaceId
                 order by period desc;
  `;
  //getLog().atInfo().log(`Running Clickhouse query: ${query}`);
  const resultSet = await clickhouse.query({
    query,
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
    query_params: removeUndefined({
      start: isoDateTOClickhouse(start),
      end: isoDateTOClickhouse(end),
      granularity,
      workspaceId,
    }),
  });
  log.atInfo().log(`Clickhouse query took ${Date.now() - timer}ms`);

  return ((await resultSet.json()) as any).data.map(({ events, period, ...rest }) => ({
    events: Number(events),
    period: period.replace(" ", "T") + ".000Z",
    ...rest,
  }));
}

function getDate(param: string | undefined, defaultVal?: string): Date {
  return param ? new Date(param) : defaultVal ? new Date(defaultVal) : new Date();
}

export async function query(pg: PG.Pool, sql: string, params: SqlQueryParameters = []): Promise<Record<string, any>[]> {
  const { query, values } = namedParameters(sql, params);
  log.atInfo().log(`Querying: ${unrollParams(query, values)}`);
  return await pg.query({ text: query, values }).then(res => {
    return res.rows;
  });
}

function minusDays(d, days) {
  return new Date(d.getTime() - days * 24 * 60 * 60 * 1000);
}

type WorkspaceInfo = {
  id: string;
  slug: string;
  name: string;
  domains?: string[];
};

type ExtendedWorkspaceReportRow = WorkspaceReportRow & WorkspaceInfo;

export async function buildWorkspaceReport(
  start: string,
  end: string,
  granularity: "day",
  workspaceId: string | undefined
): Promise<WorkspaceReportRow[]> {
  const [pgRes, chRes] = await Promise.all([
    getPostgresPart({ start, end, granularity, workspaceId }),
    getClickhousePart({ start, end, granularity, workspaceId }),
  ]);
  return [...pgRes.map(s => ({ ...s, src: "pg" })), ...chRes.map(s => ({ ...s, src: "ch" }))];
}

async function extend(reportResult: WorkspaceReportRow[]): Promise<ExtendedWorkspaceReportRow[]> {
  const workspaceInfo = await query(pg, workspaceStatSql);
  const workspaceInfoMap = workspaceInfo.reduce((acc, w) => {
    acc[w.workspaceId] = w;
    return acc;
  }, {});
  log.atInfo().log(`Got workspace info: ${JSON.stringify(workspaceInfoMap)}`);

  return reportResult.map(r => ({ ...r, ...workspaceInfoMap[r.workspaceId] }));
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
  if (req.method === "OPTIONS") {
    //allowing requests from everywhere since our tokens are short-lived
    //and can't be hijacked
    res.status(200).end();
    return;
  }
  const claims = await auth(req, res);
  if (!claims) {
    res.status(401).end();
    return;
  }
  const workspaceId = claims.type === "user" ? claims.workspaceId : (req.query.workspaceId as string) || undefined;
  const extended = req.query.extended === "true";
  const start = getDate(req.query.start as string, minusDays(new Date(), 32).toISOString()).toISOString();
  const end = getDate(req.query.end as string, new Date().toISOString()).toISOString();
  const granularity = "day"; // = ((req.query.granularity as string) || "day").toLowerCase();
  const reportResult = await buildWorkspaceReport(start, end, granularity, workspaceId);
  const records = extended ? await extend(reportResult) : reportResult;
  res.send(req.query.format === "array" ? records : { data: records });
};

export const config = {
  maxDuration: 120,
};

export default withErrorHandler(handler);
