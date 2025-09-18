import { UDFTestRun, UDFTestRequest, mongodb, createMongoStore } from "@jitsu/core-functions";
import { getLog } from "juava";
import { connectionsStore } from "../lib/repositories";

const log = getLog("udf_run");

export const UDFRunHandler = async (req, res) => {
  const body = req.body as UDFTestRequest;
  log.atInfo().log(`Running function: ${body?.functionId} workspace: ${body?.workspaceId}`, JSON.stringify(body));
  body.store = createMongoStore(body?.workspaceId, mongodb, true, false);
  const result = await UDFTestRun(body, connectionsStore.getCurrent());
  if (result.error) {
    log
      .atError()
      .log(
        `Error running function: ${body?.functionId} workspace: ${body?.workspaceId}\n${result.error.name}: ${result.error.message}`
      );
  }
  res.json(result);
};
