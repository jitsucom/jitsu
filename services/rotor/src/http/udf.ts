import {
  UDFTestRun,
  UDFTestRequest,
  mongodb,
  defaultTTL,
  createMongoStore,
  createTtlStore,
} from "@jitsu/core-functions";
import { getLog } from "juava";
import { redis } from "@jitsu-internal/console/lib/server/redis";

const log = getLog("udf_run");

export const UDFRunHandler = async (req, res) => {
  const body = req.body as UDFTestRequest;
  //log.atInfo().log(`Running function: ${body?.functionId} workspace: ${body?.workspaceId}`, JSON.stringify(body));
  body.store = process.env.MONGODB_URL
    ? createMongoStore(body?.workspaceId, mongodb(), defaultTTL)
    : createTtlStore(body?.workspaceId, redis(), defaultTTL);
  const result = await UDFTestRun(body);
  if (result.error) {
    log
      .atError()
      .log(
        `Error running function: ${body?.functionId} workspace: ${body?.workspaceId}\n${result.error.name}: ${result.error.message}`
      );
  }
  res.json(result);
};
