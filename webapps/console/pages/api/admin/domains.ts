import { Api, nextJsApiHandler } from "../../../lib/api";
import { db } from "../../../lib/server/db";

export const api: Api = {
  GET: {
    auth: false,
    handle: async ({ req, query, res }) => {
      const token = query.token;
      if (!token || process.env.CADDY_TOKEN !== token) {
        res.status(401).send({ error: "Unauthorized" });
        return;
      }
      const domain = query.domain;
      if (!domain) {
        res.status(400).send({ error: "missing required parameter" });
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
        res.status(404).send({ error: "not found" });
        return;
      }
      res.status(200).send({ ok: true });
    },
  },
};

export default nextJsApiHandler(api);
