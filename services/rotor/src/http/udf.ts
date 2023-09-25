import { createFullContext, UDFWrapper, logType, UDFTestRun, UDFTestRequest } from "@jitsu/core-functions";
import { getLog } from "juava";

const log = getLog("udf_run");

export const UDFRunHandler = async (req, res) => {
  const body = req.body as UDFTestRequest;
  log.atInfo().log(`Running function: ${body?.functionId} workspace: ${body?.workspaceId}`, JSON.stringify(body));
  const result = await UDFTestRun(body);
  if (result.error) {
    log.atError().log(`Error running function: ${body?.functionId} workspace: ${body?.workspaceId}\n${result.error}`);
  }
  res.json(result);
};
