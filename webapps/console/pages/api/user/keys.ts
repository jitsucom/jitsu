import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { ApiKey } from "../../../lib/schema";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { hint } from "juava";
import { createHash, requireDefined } from "juava";

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      result: z.array(ApiKey),
    },
    handle: async ({ user }) => {
      return await db.prisma().userApiToken.findMany({
        where: { userId: user.internalId },
        select: { id: true, hint: true, createdAt: true, lastUsed: true },
      });
    },
  },
  POST: {
    auth: true,
    types: {
      body: z.array(ApiKey),
      result: z.array(ApiKey),
    },
    handle: async ({ user, body }) => {
      const currentKeys = await db.prisma().userApiToken.findMany({
        where: { userId: user.internalId },
        select: { id: true },
      });
      const toDelete = currentKeys.filter(k => !body.find(b => b.id === k.id)).map(k => k.id);
      const toCreate = body
        .filter(b => !currentKeys.find(k => k.id === b.id))
        .map(b => {
          const plaintext = requireDefined(b.plaintext, `key ${JSON.stringify(b)} expected to contain plaintext`);
          return {
            id: b.id,
            userId: user.internalId,
            hint: hint(plaintext),
            hash: createHash(plaintext),
          };
        });

      await db.prisma().userApiToken.deleteMany({ where: { id: { in: toDelete } } });
      await db.prisma().userApiToken.createMany({ data: toCreate });

      return currentKeys;
    },
  },
};

export default nextJsApiHandler(api);
