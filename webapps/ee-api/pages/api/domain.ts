import type { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../lib/auth";
import { getErrorMessage, getLog, requireDefined } from "juava";

import fetch from "node-fetch-commonjs";
import { withErrorHandler } from "../../lib/error-handler";
import isValidDomain from "is-valid-domain";

const log = getLog("/api/domain");

const vercelProjectId = requireDefined(
  process.env.DOMAINS_VERCEL_PROJECT_ID,
  `env DOMAINS_VERCEL_PROJECT_ID is not set`
);
const vercelTeamId = requireDefined(process.env.DOMAINS_VERCEL_TEAM_ID, `env DOMAINS_VERCEL_TEAM_ID is not set`);
const vercelToken = requireDefined(process.env.DOMAINS_VERCEL_TOKEN, `env DOMAINS_VERCEL_TOKEN is not set`);
const cname = process.env.CNAME || "cname.jitsu.com";

async function rpc(url: string, method?: "GET" | "POST", body?: any): Promise<any> {
  const res = await fetch(url.indexOf("https://") === 0 ? url : `https://api.vercel.com${url}`, {
    method: method ?? "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      "Content-Type": "application/json",
    },
  });
  const txt = await res.text();
  if (!res.ok) {
    log.atError().log(`Rpc failed: ${res.status} ${res.statusText}. Response: ${txt}`);
  }
  return JSON.parse(txt);
}

export type DomainInfo = Record<string, any>;

async function getExistingDomain(domain: string): Promise<DomainInfo | undefined> {
  const result = await rpc(`/v9/projects/${vercelProjectId}/domains/${domain}?teamId=${vercelTeamId}`);
  if (result.name) {
    return result;
  } else {
    return undefined;
  }
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  log.atDebug().log(`${req.method} ${req.url} ${JSON.stringify(req.headers)}`);
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
  if (req.method === "OPTIONS") {
    //allowing requests from everywhere since our tokens are short-lived
    //and can't be hijacked
    res.status(200).end();
    return;
  }
  if (!(await auth(req, res))) {
    return;
  }
  try {
    const domain = requireDefined(req.query.domain as string, `query param domain is not set`);
    if (!isValidDomain(domain, { subdomain: true, wildcard: false })) {
      throw new Error(`Not a valid domain name`);
    }
    let domainInfo = await getExistingDomain(domain);
    if (!domainInfo) {
      domainInfo = await rpc(`/v10/projects/${vercelProjectId}/domains?teamId=${vercelTeamId}`, "POST", {
        name: domain,
      });
    }
    if (!domainInfo) {
      throw new Error(`Can't get domainInfo for ${domain}`);
    }
    if (domainInfo.error) {
      return res.status(200).json({ ok: false, error: domainInfo.error.message || domainInfo.error });
    }
    const status = await rpc(`/v6/domains/${domain}/config?teamId=${vercelTeamId}`);
    log.atDebug().log(`Checking status of domain ${domain}: ${JSON.stringify({ status, domainInfo }, null, 2)}`);
    const misconfigured = status.misconfigured;
    const verified = domainInfo.verified;
    if (!misconfigured && verified) {
      res.status(200).json({ ok: true, needsConfiguration: false });
    } else if (misconfigured) {
      res.status(200).json({ ok: true, needsConfiguration: true, configurationType: "cname", cnameValue: cname });
    } else if (!verified) {
      //request Vercel to verify domain
      const verifyInfo = await rpc(
        `/v9/projects/${vercelProjectId}/domains/${domain}/verify?teamId=${vercelTeamId}`,
        "POST"
      );
      if (!verifyInfo) {
        throw new Error(`Can't verify ${domain}`);
      }
      if (!verifyInfo.verified) {
        if (!verifyInfo.verification && !domainInfo.verification) {
          throw new Error(`Domain ${domain} is not verified, and there is no verification info`);
        }
        res.status(200).json({
          ok: true,
          needsConfiguration: true,
          configurationType: "verification",
          verification: verifyInfo.verification || domainInfo.verification,
        });
      } else {
        res.status(200).json({ ok: true, needsConfiguration: false });
      }
    } else {
      throw new Error(`Unexpected state: misconfigured=${misconfigured}, verified=${verified} `);
    }
  } catch (e) {
    log.atError().withCause(e).log(`${req.url} failed`);
    return res.status(200).json({ ok: false, error: getErrorMessage(e) });
  }
};
export default withErrorHandler(handler);
