import { getServerLog } from "../../../lib/server/log";

import { z } from "zod";
import { customDomainCnames, isDomainAvailable, checkOrAddToIngress } from "../../../lib/server/custom-domains";
import { DomainCheckResponse } from "../../../lib/shared/domain-check-response";
import { createRoute, verifyAccess } from "../../../lib/api";
import { db } from "../../../lib/server/db";

const log = getServerLog("custom-domains");

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      domain: z.string(),
    }),
    result: DomainCheckResponse,
  })
  .handler(async ({ user, query: { workspaceId, domain } }) => {
    if (!customDomainCnames || customDomainCnames.length == 0) {
      throw new Error(`CUSTOM_DOMAIN_CNAMES is not set`);
    }
    await verifyAccess(user, workspaceId);
    const domainAvailability = await isDomainAvailable(domain, workspaceId);
    if (!domainAvailability.available) {
      log
        .atWarn()
        .log(
          `Domain '${domain}' can't be added to workspace ${workspaceId}. It is used by ${domainAvailability.usedInWorkspace}`
        );
      return { ok: false, reason: "used_by_other_workspace" };
    }
    let domainToCheck = domain;
    if (!domain.startsWith("*")) {
      const wildcardDomains = await getWildcardDomains(workspaceId);
      for (const wildcardDomain of wildcardDomains) {
        if (
          domain.toLowerCase().endsWith(wildcardDomain.toLowerCase().replace("*", "")) &&
          domain.toLowerCase() !== wildcardDomain.toLowerCase()
        ) {
          domainToCheck = wildcardDomain;
          break;
        }
      }
    }

    try {
      const ingressStatus = await checkOrAddToIngress(domainToCheck);
      log.atInfo().log(`Ingress status for ${domainToCheck}: ${JSON.stringify(ingressStatus)}`);
      if (!ingressStatus) {
        log.atWarn().log(`Incorrect ingress status ${domainToCheck} is not valid`);
        return { ok: false, reason: "internal_error" };
      }
      if (ingressStatus.status === "ok") {
        return { ok: true };
      } else if (ingressStatus.status === "pending_ssl") {
        return { ok: false, reason: "pending_ssl" };
      } else if (ingressStatus.status === "dns_error") {
        return {
          ok: false,
          reason: "requires_cname_configuration",
          cnames: ingressStatus.cnames ?? [{ name: domainToCheck, value: customDomainCnames[0], ok: false }],
        };
      } else {
        return { ok: false, reason: "internal_error" };
      }
    } catch (e) {
      log.atError().withCause(e).log(`Error checking ingress status for ${domainToCheck}`);
      return { ok: false, reason: "internal_error" };
    }
  })
  .toNextApiHandler();

export async function getWildcardDomains(workspaceId: string): Promise<string[]> {
  const objs = await db.prisma().configurationObject.findMany({
    where: {
      workspaceId: workspaceId,
      deleted: false,
      type: "domain",
      workspace: { deleted: false },
    },
  });
  return objs
    .map(obj => {
      const config = obj.config as any;
      return config.name;
    })
    .filter(name => name.startsWith("*"));
}
