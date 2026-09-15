import { createRoute } from "../../lib/api";
import { getApplicationVersion } from "../../lib/version";
import { getServerEnv } from "../../lib/server/serverEnv";

export default createRoute()
  .GET({
    auth: false,
  })
  .handler(async () => {
    const serverEnv = getServerEnv();
    return {
      ...getApplicationVersion(),
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        env: serverEnv.NODE_ENV,
      },
    };
  })
  .toNextApiHandler();
