import { Api, nextJsApiHandler, verifyAdmin } from "../../../../lib/api";
import * as emailTemplates from "../../../../lib/server/templates";

export const api: Api = {
  GET: {
    auth: true,
    handle: async ({ user }) => {
      await verifyAdmin(user);
      return {
        templates: Object.keys(emailTemplates),
      };
    },
  },
};

export default nextJsApiHandler(api);
