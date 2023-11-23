import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { requireDefined } from "juava";
import { getFirebaseUser, linkFirebaseUser } from "../../../lib/server/firebase-server";
import { getOrCreateUser } from "../../../lib/nextauth.config";

export const api: Api = {
  url: inferUrl(__filename),
  POST: {
    auth: false,
    handle: async ({ req, res }) => {
      const user = requireDefined(await getFirebaseUser(req), `Not authorized`);
      if (!user.internalId) {
        const dbUser = await getOrCreateUser({
          externalId: user.externalId,
          loginProvider: "firebase",
          email: user.email,
          name: user.name || user.email,
          req,
        });
        await linkFirebaseUser(user.externalId, dbUser.id);
      }
      return {};
    },
  },
};

export default nextJsApiHandler(api);
