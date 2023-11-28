import { Api, nextJsApiHandler } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { ApiError } from "../../../lib/shared/errors";

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
