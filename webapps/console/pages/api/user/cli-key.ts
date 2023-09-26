import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { ApiKey } from "../../../lib/schema";
import { db } from "../../../lib/server/db";
import { hint, randomId } from "juava";
import { createHash } from "juava";

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      result: ApiKey,
    },
    handle: async ({ user, req, res }) => {
      const newKey = randomId(32);
      const key = { id: `jitsu-cli-${randomId(22)}`, plaintext: newKey };
      const toCreate = {
        id: key.id,
        userId: user.internalId,
        hint: hint(newKey),
        hash: createHash(newKey),
      };
      await db.prisma().userApiToken.create({ data: toCreate });

      return key;
    },
  },
};

export default nextJsApiHandler(api);
