import { createRoute } from "../../../lib/api";
import { nangoConfig } from "../../../lib/server/oauth/nango-config";
import { assertTrue } from "juava";

export default createRoute()
  .GET({ auth: true })
  .handler(async ({ res }) => {
    assertTrue(nangoConfig.enabled, "Oauth is disabled");
    res.redirect(nangoConfig.callback);
  })
  .toNextApiHandler();
