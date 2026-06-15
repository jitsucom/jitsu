import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { ApiKey } from "../../../lib/schema";
import { db } from "../../../lib/server/db";
import { hint, randomId } from "juava";
import { createHash } from "juava";

const CLI_KEY_EXPIRATION_DAYS = 90;

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      result: ApiKey,
    },
    handle: async ({ user }) => {
      const newKey = randomId({ digits: 32, strongRandom: true });
      const id = `jitsu-cli-${randomId(22)}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + CLI_KEY_EXPIRATION_DAYS);
      await db.prisma().userApiToken.create({
        data: {
          id,
          userId: user.internalId,
          hint: hint(newKey),
          hash: createHash(newKey),
          type: "cli",
          name: "jitsu-cli",
          expiresAt,
        },
      });
      return { id, plaintext: newKey, expiresAt, type: "cli", name: "jitsu-cli" };
    },
  },
};

export default nextJsApiHandler(api);
