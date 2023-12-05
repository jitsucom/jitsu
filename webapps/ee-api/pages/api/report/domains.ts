import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../../lib/auth";
import { assertTrue, getLog } from "juava";
import { applicationDb } from "../../../lib/services";
import { withErrorHandler } from "../../../lib/error-handler";
import { getExistingDomain, vercelRpc, vercelTeamId } from "../../../lib/vercel";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const claims = await auth(req, res);
  assertTrue(claims?.type === "admin", "Should be admin");
  const queryResult = await applicationDb.query(`
      select
          s.id,
          s.config ->> 'name' as "streamName",
          s."updatedAt" as "updatedAt",
          s.config,
          w.slug as "workspaceSlug",
          w.name as "workspaceName"
      from newjitsu."ConfigurationObject" s
           join newjitsu."Workspace" w on w.id = s."workspaceId"
      where s.type = 'stream'
        and s.config ->> 'domains' <> '[]'
  `);
  const result: any[] = [];
  res.setHeader("Content-Type", "application/json");
  res.status(200);
  try {
    //we need to do it in streaming mode, otherwise Vercel wll timeout
    res.write("[\n");
    let firstRow = true;
    //some domains can be configured for multiple stream, so a little optimization here
    const localCache: Record<string, any> = {};
    for (const row of queryResult.rows) {
      const domains = row.config.domains;
      for (const domain of domains) {
        let domainStatus: any;
        let domainInfo: any;
        if (localCache[domain]) {
          getLog().atDebug().log(`Domain ${domain} has been already checked`);
          domainStatus = localCache[domain].domainStatus;
          domainInfo = localCache[domain].domainInfo;
        } else {
          getLog().atDebug().log(`Checking domain ${domain}`);
          domainStatus = await vercelRpc(`/v6/domains/${domain}/config?teamId=${vercelTeamId}`);
          domainInfo = (await getExistingDomain(domain)) || {};
          localCache[domain] = { domainStatus, domainInfo };
          getLog()
            .atDebug()
            .log(`Domain ${domain} info:\n${JSON.stringify({ domainStatus, domainInfo }, null, 2)}`);
        }
        let configured: boolean;
        let misconfigurationReason: any = null;
        if (!domainStatus?.misconfigured && domainInfo?.verified) {
          configured = true;
        } else if (domainInfo?.misconfigured) {
          configured = false;
          misconfigurationReason = "cname";
        } else {
          configured = false;
          misconfigurationReason = "verification_required";
        }
        const workspaceLink = `https://use.jitsu.com/${row.workspaceSlug || row.workspaceId}`;
        const resultRow = {
          domain,
          configured,
          misconfigurationReason,
          lastUpdated: domainStatus.updatedAt ? new Date(domainStatus.updatedAt) : row.updatedAt,
          workspaceId: row.workspaceId,
          sourceId: row.id,
          sourceLink: `${workspaceLink}/streams?id=${row.id}`,
          workspaceLink,
        };
        res.write(`${firstRow ? "" : ",\n"}${JSON.stringify(resultRow)}`);
        getLog()
          .atDebug()
          .log(
            `Domain ${domain} is ${configured ? "configured" : "not configured"}. Full info: ${JSON.stringify(
              resultRow
            )}`
          );
        firstRow = false;
      }
    }
    res.write("\n]");
  } finally {
    //no catch block here, since in streaming it's not hard to display error to the user
    res.end();
  }
};

export const config = {
  maxDuration: 3600,
};

export default withErrorHandler(handler);
