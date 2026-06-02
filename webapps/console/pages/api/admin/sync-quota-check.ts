import { z } from "zod";
import { createRoute } from "../../../lib/api";
import { getServerEnv } from "../../../lib/server/serverEnv";
import { getServerLog } from "../../../lib/server/log";
import { checkQuota } from "../../../lib/server/sync";
import { isEEAvailable } from "../../../lib/server/ee";

const log = getServerLog("sync-quota-check");
const serverEnv = getServerEnv();

// Admission gate for syncctl-spawned read Pods: called by the sidecar's
// `quota-check` init container *before* the Pod does any real work, so we
// don't spend pod minutes on a sync the workspace can't afford. The same
// `checkQuota` helper is invoked from `scheduleSync` for manual /sources/run
// triggers, so both entry points enforce identical quota semantics.
//
// Auth: SYNCCTL_AUTH_KEY bearer. EE JWT signing stays in the console process
// — sidecar pods don't need the EE private key.
//
// 200 on pass, 403 on quota exceeded. EE-unreachable / billing-server-down
// falls through to admission (fail-open inside `checkQuota`) so a billing
// blip doesn't paralyze every scheduled sync.
export default createRoute()
  .GET({
    auth: false,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
      package: z.string(),
      version: z.string(),
      taskId: z.string().optional(),
      startedBy: z.string().optional(),
    }),
  })
  .handler(async ({ req, res, query }) => {
    const syncAuthKey = serverEnv.SYNCCTL_AUTH_KEY ?? "";
    const token = (req.headers.authorization ?? "").replace("Bearer ", "");
    if (!syncAuthKey || !token || token !== syncAuthKey) {
      res.status(401).send({ ok: false, error: "Authorization Required" });
      return;
    }
    if (!isEEAvailable()) {
      // No EE → no quotas → admit.
      res.status(200).send({ ok: true, ee: false });
      return;
    }
    let startedBy: any = { trigger: "scheduled" };
    if (query.startedBy) {
      try {
        startedBy = JSON.parse(query.startedBy);
      } catch {
        // ignore malformed startedBy — fall back to default
      }
    }
    // Derive the trigger from startedBy rather than hardcoding "scheduled":
    // manual /sources/run pods also run this admission init now, and labeling
    // their quota check as "scheduled" would misattribute usage (console's
    // scheduleSync already checked manual quota before dispatching /read).
    const trigger = startedBy?.trigger === "manual" ? "manual" : "scheduled";
    const result = await checkQuota({
      req,
      trigger,
      workspaceId: query.workspaceId,
      syncId: query.syncId,
      package: query.package,
      version: query.version,
      taskId: query.taskId,
      startedBy,
    });
    if (result && !result.ok) {
      log
        .atWarn()
        .log(
          `quota check failed for sync=${query.syncId} workspace=${query.workspaceId} task=${query.taskId ?? "-"}: ${
            result.error
          }`
        );
      // 200 with ok=false — this is the verdict, not an HTTP error. The sidecar
      // blocks only on a parsed ok=false; any non-200 it reads as fail-open and
      // lets the run through. 401 (auth) stays the sole non-200 outcome.
      res.status(200).send({ ok: false, error: result.error, errorType: result.errorType });
      return;
    }
    res.status(200).send({ ok: true });
  })
  .toNextApiHandler();
