import { createRoute } from "../../../lib/api";
import { oauthDecorators } from "../../../lib/server/oauth/services";
import omit from "lodash/omit";

export default createRoute()
  .GET({ auth: true })
  .handler(async ({ res }) => {
    return { decorators: oauthDecorators.map(s => omit(s, "merge")) };
  })
  .toNextApiHandler();
