import { db } from "./db";
import { StreamConfig } from "../schema";
import dns from "dns";
import { getLog } from "juava";

type DomainAvailability = { available: true; usedInWorkspaces?: never } | { available: false; usedInWorkspace: string };

export const customDomainCnames = process.env.CUSTOM_DOMAIN_CNAMES?.split(",");

/**
 * Tells if the given domain is used in other workspaces.
 */
export async function isDomainAvailable(domain: string, workspaceId: string): Promise<DomainAvailability> {
  const pattern = `%${domain.toLowerCase()}%`;
  const dirtyList = (await db.prisma().$queryRaw`
      select "id", "workspaceId", "config"
      from "ConfigurationObject"
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

function resolveCname(domain: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
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
}

export async function isCnameValid(domain: string): Promise<boolean> {
  if (!customDomainCnames || customDomainCnames.length == 0) {
    throw new Error(`CUSTOM_DOMAIN_CNAMES is not set. isCnameValid() should not be called`);
  }
  let cnameRecord: string | undefined;
  try {
    cnameRecord = await resolveCname(domain);
  } catch (e) {
    getLog().atError().withCause(e).log(`Domain ${domain} has no CNAME records`);
    return false;
  }
  return !!(cnameRecord && customDomainCnames.includes(cnameRecord.toLowerCase()));
}
