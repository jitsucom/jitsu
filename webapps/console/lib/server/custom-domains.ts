import { db } from "./db";
import dns from "dns";
import { getLog, requireDefined } from "juava";
import { httpAgent, httpsAgent } from "./http-agent";
import { z } from "zod";
import { WorkspaceDbModel } from "../../prisma/schema";
import { Prisma, PrismaClient } from "@prisma/client";
import { ApiError } from "../shared/errors";
import { getServerEnv } from "./serverEnv";

type DomainAvailability = { available: true; usedInWorkspaces?: never } | { available: false; usedInWorkspace: string };

export const customDomainCnames = getServerEnv().CUSTOM_DOMAIN_CNAMES?.split(",");

export function checkDomain(domain: string): boolean {
  return !!domain.match(/^(?:[*][.])?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/);
}
/**
 * Tells if the given domain is used in other workspaces.
 */
export async function isDomainAvailable(
  domain: string,
  workspace: z.infer<typeof WorkspaceDbModel>
): Promise<DomainAvailability> {
  const workspaceId = workspace.id;
  const siblings = (workspace.featuresEnabled ?? [])
    .filter(f => f.startsWith("sibling="))
    .flatMap(f => f.replace("sibling=", "").split(","));
  siblings.push(workspaceId);

  const domainSuffix = domain.replace(/^[*]/, "");
  const fullTextPattern = `%${domainSuffix.toLowerCase()}%`;
  const pattern = `%${domainSuffix.toLowerCase()}`;
  // objects of a deleted workspace stay in the table, but no longer route, so they do not hold the domain
  const dirtyList = (await db.prisma().$queryRaw`
      select id,type, "workspaceId", config->'domains' as domains
      from newjitsu."ConfigurationObject"
      where type = 'stream'
        and config::TEXT ilike ${fullTextPattern}
        and "workspaceId" not in (${Prisma.join(siblings)})
        and "workspaceId" not in (select id from newjitsu."Workspace" where deleted = true)
        and deleted = false
      union
      select id,type, "workspaceId", jsonb_build_array(config->'name') as domains
      from newjitsu."ConfigurationObject"
      where type = 'domain'
        and (config->>'name' ilike ${pattern} or ${domain.toLowerCase()} ilike REPLACE(config->>'name','*','%') )
        and "workspaceId" not in (${Prisma.join(siblings)})
        and "workspaceId" not in (select id from newjitsu."Workspace" where deleted = true)
        and deleted = false
  `) as { id: string; workspaceId: string; domains: string[] }[];

  // Same domain or a subdomain of it, on a label boundary: `not.example.com` is not under `t.example.com`
  const bare = domainSuffix.toLowerCase();
  const isUnder = (d: string) => {
    const other = d.toLowerCase();
    return bare.startsWith(".") ? other.endsWith(bare) : other === bare || other.endsWith("." + bare);
  };
  const list = dirtyList.filter(({ domains }) => {
    return (
      (domains || []).filter(isUnder).length > 0 ||
      (domains || []).filter(d => {
        return d.startsWith("*") && domain.toLowerCase().endsWith(d.toLowerCase().replace(/^[*]/, ""));
      }).length > 0
    );
  });

  if (list.length > 0) {
    return { available: false, usedInWorkspace: list[0].workspaceId };
  } else {
    return { available: true };
  }
}

/** Domains an object of this type claims: stream `domains`, domain `name`. */
function claimedDomains(type: string, object: any): string[] {
  const names = type === "stream" ? object?.domains : type === "domain" ? [object?.name] : [];
  return (names ?? []).filter(Boolean).map((d: string) => d.trim().toLowerCase());
}

/**
 * isDomainAvailable() followed by an insert is check-then-act: two workspaces claiming the same domain at the same
 * moment both pass the check. Writes that claim a domain run under one global lock and repeat the check after taking
 * it, so the second claim sees the first (the lock is released at commit).
 */
export async function writeClaimingDomains<T>(
  prisma: PrismaClient,
  workspace: z.infer<typeof WorkspaceDbModel>,
  type: string,
  object: unknown,
  write: (db: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const domains = claimedDomains(type, object);
  if (domains.length === 0) return write(prisma);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('domain-claim', 0))`;
    for (const domain of domains) {
      if (!(await isDomainAvailable(domain, workspace)).available) {
        throw new ApiError(`Domain ${domain} is already in use by other workspace`);
      }
    }
    return write(tx);
  });
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
  const serverEnv = getServerEnv();
  const ingmgrURLEnv = requireDefined(serverEnv.INGMGR_URL, "env INGMGR_URL is not defined");
  const ingmgrAuthKey = serverEnv.INGMGR_AUTH_KEY ?? "";
  const isHttps = ingmgrURLEnv.startsWith("https://");
  const options = {
    agent: (isHttps ? httpsAgent : httpAgent)(),
    headers: {},
  };
  if (ingmgrAuthKey) {
    options.headers["Authorization"] = `Bearer ${ingmgrAuthKey}`;
  }
  try {
    const response = await fetch(ingmgrURLEnv + "/api/domain?name=" + domain, options);
    return await response.json();
  } catch (e: any) {
    return { error: e.message };
  }
}
