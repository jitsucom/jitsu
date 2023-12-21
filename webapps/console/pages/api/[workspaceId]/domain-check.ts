import { getServerLog } from "../../../lib/server/log";

import { z } from "zod";
import { customDomainCnames, isCnameValid, isDomainAvailable } from "../../../lib/server/custom-domains";
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

    const cnameValid = await isCnameValid(domain);
    if (!cnameValid) {
      log.atWarn().log(`Domain ${domain} is not valid`);
      return { ok: false, reason: "requires_cname_configuration", cnameValue: customDomainCnames[0] };
    }
    return { ok: true };
  })
  .toNextApiHandler();
