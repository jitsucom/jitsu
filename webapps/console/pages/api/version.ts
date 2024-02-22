import { createRoute } from "../../lib/api";
import { getApplicationVersion } from "../../lib/version";
import { isTruish } from "juava";

function sortByKey(dict: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)));
}

function getDiagnostics() {
  if (isTruish(process.env.__DANGEROUS_ENABLE_FULL_DIAGNOSTICS)) {
    return {
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
    return {
      ...getApplicationVersion(),
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        env: process.env.NODE_ENV,
      },
      diagnostics: getDiagnostics(),
    };
  })
  .toNextApiHandler();
