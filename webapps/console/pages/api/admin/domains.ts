import { Api, nextJsApiHandler } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { ApiError } from "../../../lib/shared/errors";

//For Caddy to allow issuing certificates for a domain, it must be present in the domains array of a stream object.
//or it must be a subdomain of the data domain
export const api: Api = {
  GET: {
    auth: false,
    handle: async ({ req, query, res }) => {
      const token = query.token;
      if (!token || process.env.CADDY_TOKEN !== token) {
        throw new ApiError("Unauthorized", {}, { status: 401 });
      }
      const domain = query.domain;
      if (!domain) {
        throw new ApiError("missing required parameter", {}, { status: 400 });
      }
      const dataDomain = process.env.DATA_DOMAIN;
      if (domain === dataDomain || domain.endsWith("." + dataDomain)) {
        //data domain and subdomains are always allowed
        return;
      }
      const stream = await db.prisma().configurationObject.findFirst({
        where: {
          type: "stream",
          deleted: false,
          config: {
            path: ["domains"],
            array_contains: [domain],
          },
        },
      });
      if (!stream) {
        throw new ApiError("not found", {}, { status: 404 });
      }
    },
  },
};

export default nextJsApiHandler(api);
