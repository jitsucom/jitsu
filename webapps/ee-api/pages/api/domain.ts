import type { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../lib/auth";
import { getErrorMessage, requireDefined } from "juava";
import dns from "dns";
import { withErrorHandler } from "../../lib/error-handler";
import isValidDomain from "is-valid-domain";
import { getServerLog } from "../../lib/log";
import { getExistingDomain, vercelCname, vercelProjectId, vercelRpc, vercelTeamId } from "../../lib/vercel";

const log = getServerLog("/api/domain");


function resolveCname(domain: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dns.resolveCname(domain, (err, addresses) => {
      if (err) {
        reject(err);
      } else {
        resolve(addresses);
      }
    });
  });
}

const alternativeCname = process.env.CUSTOM_DOMAIN_CNAMES?.split(",");

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

    if (alternativeCname && alternativeCname.length > 0) {
      try {
        const cnames = await resolveCname(domain);
        if (cnames.length > 0) {
          const configuredCname = cnames.find(cname => alternativeCname.includes(cname));
          if (configuredCname) {
            res.status(200).json({ ok: true, needsConfiguration: false, configuredCname });
            return;
          } else {
            res
              .status(200)
              .json({ ok: false, needsConfiguration: true, configurationType: "cname", cnameValue: alternativeCname[0] });
            return;
          }
        } else {
          if (vercelProjectId) {
            //continue with vercel
          } else {
            res
              .status(200)
              .json({ ok: false, needsConfiguration: true, configurationType: "cname", cnameValue: alternativeCname[0] });
          }
        }
      } catch (e) {
        if (vercelProjectId) {
          //continue with vercel
        } else {
          res
            .status(200)
            .json({ ok: false, needsConfiguration: true, configurationType: "cname", cnameValue: alternativeCname[0] });
        }
      }
    }

    let domainInfo = await getExistingDomain(domain);
    if (!domainInfo) {
      domainInfo = await vercelRpc(`/v10/projects/${vercelProjectId}/domains?teamId=${vercelTeamId}`, "POST", {
        name: domain,
      });
    }
    if (!domainInfo) {
      throw new Error(`Can't get domainInfo for ${domain}`);
    }
    if (domainInfo.error) {
      return res.status(200).json({ ok: false, error: domainInfo.error.message || domainInfo.error });
    }
    const status = await vercelRpc(`/v6/domains/${domain}/config?teamId=${vercelTeamId}`);
    log.atDebug().log(`Checking status of domain ${domain}: ${JSON.stringify({ status, domainInfo }, null, 2)}`);
    const misconfigured = status.misconfigured;
    const verified = domainInfo.verified;
    if (!misconfigured && verified) {
      res.status(200).json({ ok: true, needsConfiguration: false });
    } else if (misconfigured) {
      res.status(200).json({ ok: true, needsConfiguration: true, configurationType: "cname", cnameValue: vercelCname });
    } else if (!verified) {
      //request Vercel to verify domain
      const verifyInfo = await vercelRpc(
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
