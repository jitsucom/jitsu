import { createRoute } from "../../lib/api";
import { getApplicationVersion } from "../../lib/version";
import { isTruish } from "juava";
import { getServerEnv } from "../../lib/server/serverEnv";

function sortByKey(dict: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)));
}

function getDiagnostics() {
  const serverEnv = getServerEnv();
  if (isTruish(serverEnv.__DANGEROUS_ENABLE_FULL_DIAGNOSTICS)) {
    return {
      // eslint-disable-next-line no-restricted-properties
      env: sortByKey(process.env),
      proc: {
        config: sortByKey(process.config),
        versions: sortByKey(process.versions),
        execPath: process.execPath,
        argv: process.argv,
      },
    };
  }
}

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
      diagnostics: getDiagnostics(),
    };
  })
  .toNextApiHandler();
