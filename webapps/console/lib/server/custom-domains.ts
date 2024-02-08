import { db } from "./db";
import { StreamConfig } from "../schema";
import dns from "dns";
import { getLog, requireDefined } from "juava";
import { httpAgent, httpsAgent } from "./http-agent";
import nodeFetch from "node-fetch-commonjs";

type DomainAvailability = { available: true; usedInWorkspaces?: never } | { available: false; usedInWorkspace: string };

export const customDomainCnames = process.env.CUSTOM_DOMAIN_CNAMES?.split(",");

/**
 * Tells if the given domain is used in other workspaces.
 */
export async function isDomainAvailable(domain: string, workspaceId: string): Promise<DomainAvailability> {
  const pattern = `%${domain.toLowerCase()}%`;
  const dirtyList = (await db.prisma().$queryRaw`
      select "id", "workspaceId", "config"
      from newjitsu."ConfigurationObject"
      where type = 'stream'
        and config::TEXT ilike ${pattern}
        and "workspaceId" <> ${workspaceId}
  `) as { id: string; workspaceId: string; config: string }[];
  const list = dirtyList.filter(({ config, ...props }) => {
    const stream = StreamConfig.parse({ ...(config as any), ...props });
    return (stream.domains || []).map(d => d.toLowerCase()).includes(domain.toLowerCase());
  });

  if (list.length > 0) {
    return { available: false, usedInWorkspace: list[0].workspaceId };
  } else {
    return { available: true };
  }
}

export async function resolveCname(domain: string): Promise<string | undefined> {
  try {
    return await new Promise((resolve, reject) => {
      dns.resolveCname(domain, (err, addresses) => {
        if (err) {
          reject(err);
        } else {
          if (addresses.length === 1) {
            resolve(addresses[0]);
          } else if (!addresses || addresses.length === 0) {
            resolve(undefined);
          } else {
            getLog()
              .atWarn()
              .log(`Domain ${domain} has multiple CNAME records: ${addresses.join(", ")}. Using first one`);
            resolve(addresses[0]);
          }
        }
      });
    });
  } catch (e) {
    getLog().atError().withCause(e).log(`Domain ${domain} has no CNAME records`);
    return undefined;
  }
}

export async function isDomainCnameValid(domain: string): Promise<boolean> {
  let cnameRecord: string | undefined;
  try {
    cnameRecord = await resolveCname(domain);
    return await checkCname(cnameRecord);
  } catch (e) {
    getLog().atError().withCause(e).log(`Domain ${domain} has no CNAME records`);
    return false;
  }
}

export async function checkCname(cname?: string): Promise<boolean> {
  if (!customDomainCnames || customDomainCnames.length == 0) {
    throw new Error(`CUSTOM_DOMAIN_CNAMES is not set. isCnameValid() should not be called`);
  }
  return !!(cname && customDomainCnames.includes(cname.toLowerCase()));
}

export async function checkOrAddToIngress(domain: string): Promise<any> {
  const ingmgrURLEnv = requireDefined(process.env.INGMGR_URL, "env INGMGR_URL is not defined");
  const ingmgrAuthKey = process.env.INGMGR_AUTH_KEY ?? "";
  const isHttps = ingmgrURLEnv.startsWith("https://");
  const options = {
    agent: (isHttps ? httpsAgent : httpAgent)(),
    headers: {},
  };
  if (ingmgrAuthKey) {
    options.headers["Authorization"] = `Bearer ${ingmgrAuthKey}`;
  }
  try {
    const response = await nodeFetch(ingmgrURLEnv + "/api/domain?name=" + domain, options);
    return await response.json();
  } catch (e: any) {
    return { error: e.message };
  }
}
