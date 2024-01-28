import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { ApiError } from "../../../lib/shared/errors";
import { dataDomains } from "../../../lib/server/data-domains";
import { z } from "zod";
import { getLog } from "juava";

export const log = getLog("caddy-domains");
//For Caddy to allow issuing certificates for a domain, it must be present in the domains array of a stream object.
//or it must be a subdomain of the data domain
export default createRoute()
  .GET({
    auth: false,
    query: z.object({
      domain: z.string(),
      token: z.string(),
    }),
  })
  .handler(async ({ query: { token, domain }, res }) => {
    if (!dataDomains) {
      throw new ApiError(`Domain ${domain} not found. Data domains configuration is absent`, {}, { status: 404 });
    }
    if (!token || process.env.CADDY_TOKEN !== token) {
      throw new ApiError("Unauthorized", {}, { status: 401 });
    }
    if (domain.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
      res.status(404);
      return;
    }
    log.atInfo().log(`Validating domain ${domain}`);

    const streamId = [...dataDomains]
      .map(dataDomain => {
        if (domain?.toLowerCase().endsWith("." + dataDomain)) {
          return domain.substring(0, domain.length - dataDomain.length - 1);
        } else {
          return undefined;
        }
      })
      .find(Boolean);

    if (streamId) {
      log.atInfo().log(`Stream ${streamId} extracted from ${domain}`);
      const stream = await db.prisma().configurationObject.findFirst({
        where: {
          type: "stream",
          deleted: false,
          id: streamId,
        },
      });
      if (stream) {
        return { ok: true, details: `Stream ${streamId} found` };
      } else {
        log.atWarn().log(`Stream ${streamId} extracted from ${domain} not found`);
        throw new ApiError(`Slug ${streamId} for ${domain} not found`, {}, { status: 404 });
      }
    } else {
      log.atInfo().log(`Stream not found for ${domain}. Searching by custom domain`);
      const streams = await db.prisma().configurationObject.findMany({
        where: {
          type: "stream",
          deleted: false,
          config: {
            path: ["domains"],
            array_contains: [domain],
          },
        },
      });
      if (!streams || streams.length === 0) {
        log.atWarn().log(`Custom domain ${domain} not found`);
        throw new ApiError(`Domain ${domain} not found`, {}, { status: 404 });
      } else {
        log
          .atWarn()
          .log(`Found ${streams.length} streams for custom domain ${domain}: ${streams.map(s => s.id).join(", ")}`);
        return { ok: true, details: `${streams.length} streams found` };
      }
    }
  })
  .toNextApiHandler();
