import { getServerLog } from "../../../lib/server/log";

import { z } from "zod";
import { customDomainCnames, isDomainAvailable, checkOrAddToIngress } from "../../../lib/server/custom-domains";
import { DomainCheckResponse } from "../../../lib/shared/domain-check-response";
import { createRoute, verifyAccess } from "../../../lib/api";

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
    try {
      const ingressStatus = await checkOrAddToIngress(domain);
      log.atInfo().log(`Ingress status for ${domain}: ${JSON.stringify(ingressStatus)}`);
      if (!ingressStatus) {
        log.atWarn().log(`Incorrect ingress status ${domain} is not valid`);
        return { ok: false, reason: "internal_error" };
      }
      if (ingressStatus.status === "ok") {
        return { ok: true };
      } else if (ingressStatus.status === "pending_ssl") {
        return { ok: false, reason: "pending_ssl" };
      } else if (ingressStatus.status === "dns_error") {
        return { ok: false, reason: "requires_cname_configuration", cnameValue: customDomainCnames[0] };
      } else {
        return { ok: false, reason: "internal_error" };
      }
    } catch (e) {
      log.atError().withCause(e).log(`Error checking ingress status for ${domain}`);
      return { ok: false, reason: "internal_error" };
    }
  })
  .toNextApiHandler();
