import { getLog } from "juava";
import { connectionsStore } from "../lib/repositories";
import { ProfileUDFTestRequest, ProfileUDFTestRun } from "../lib/profiles-udf-wrapper";
import { createMongoStore, mongodb } from "../lib/mongodb";

const log = getLog("profile-udf-run");

export const ProfileUDFRunHandler = async (req, res) => {
  const body = req.body as ProfileUDFTestRequest;
  log.atInfo().log(`Running profile func: ${body?.id} workspace: ${body?.workspaceId}`, JSON.stringify(body));
  body.store = createMongoStore(body?.workspaceId, mongodb, true, false);
  const result = await ProfileUDFTestRun(body, connectionsStore.getCurrent());
  if (result.error) {
    log
      .atError()
      .log(
        `Error running profile function: ${body?.id} workspace: ${body?.workspaceId}\n${result.error.name}: ${result.error.message}`
      );
  }
  res.json(result);
};
