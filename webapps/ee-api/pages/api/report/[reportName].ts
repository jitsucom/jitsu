import type { NextApiRequest, NextApiResponse } from "next";
import { getLog, namedParameters, requireDefined, SqlQueryParameters, unrollParams } from "juava";
import { withErrorHandler } from "../../../lib/error-handler";
import { auth } from "../../../lib/auth";
import { pg } from "../../../lib/services";
import * as PG from "pg";

const log = getLog("/api/report");

const queries: Record<string, (opts: { metricsTable: string }) => string> = {
  //newjitsu schema is hardcoded here, should be fixed
  //newjitsu schema is hardcoded here, should be fixed
  "destination-stat": () => `
      select
          date (m.timestamp) as day, case when length (obj.data->> 'mode') > 0 then 'warehouse' else 'service'
      end as destination_type,
            sum(m.value) as events
        from newjitsuee.bulker_metrics m
        left join newjitsu."ConfigurationObjectLink" obj on obj."id"=m."destinationId"
        where
            m.metric_name='bulkerapp_ingest_messages' and
            m.status='success' and
            m.timestamp > now() - interval '30 day' and
            obj."workspaceId" = :workspaceId and
            date_trunc(:granularity, "timestamp") >= date_trunc(:granularity, :start::TIMESTAMP) and 
            date_trunc(:granularity, "timestamp") <= date_trunc(:granularity, :end::TIMESTAMP)
        group by day, destination_type order by day, destination_type desc;
  `,
};

function getDate(param: string | undefined, defaultVal?: string): Date {
  return param ? new Date(param) : defaultVal ? new Date(defaultVal) : new Date();
}

async function query(pg: PG.Pool, sql: string, params: SqlQueryParameters = []): Promise<Record<string, any>[]> {
  const { query, values } = namedParameters(sql, params);
  log.atInfo().log(`Querying: ${unrollParams(query, values)}`);
  return await pg.query({ text: query, values }).then(res => {
    return res.rows;
  });
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
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
  const workspaceId =
    claims.type === "user"
      ? claims.workspaceId
      : requireDefined(req.query.workspaceId as string, "workspaceId must be set as get parameter for admin auth");
  const start = getDate(req.query.start as string, "2010-01-01").toISOString();
  const end = getDate(req.query.end as string)?.toISOString() || new Date().toISOString();
  const granularity = ((req.query.granularity as string) || "day").toLowerCase();
  if (!["day", "hour"].includes(granularity)) {
    throw new Error(`Invalid granularity: ${granularity}`);
  }
  const metricsTable = `${process.env.METRICS_SCHEMA || "bulker"}.bulker_metrics`;
  const reportName = requireDefined(req.query.reportName, `No [reportName] in URL`) as string;
  const sqlQuery = requireDefined(queries[reportName], `Unknown report ${reportName}`)({ metricsTable });

  const data = await query(await pg(), sqlQuery, { workspaceId, granularity, start, end });
  return { data };
};

export default withErrorHandler(handler);
