import { getLog, requireDefined } from "juava";
import { getServerEnv } from "../serverEnv";
import { connectionsStore } from "../lib/repositories";
import { undiciAgent } from "../lib/functions-server-client";
import { request } from "undici";

const log = getLog("profile-udf-run");
const serverEnv = getServerEnv();

/**
 * @deprecated Function Server endpoint must be used instead
 */
export const ProfileUDFRunHandler = async (req, res) => {
  const body = req.body;
  log.atInfo().log(`Running profile func: ${body?.id} workspace: ${body?.workspaceId}`);

  try {
    // Find the functions server for this workspace via any connection's functionsServer info
    const connStore = connectionsStore.getCurrent();
    let deploymentId: string | undefined;
    if (connStore) {
      for (const conn of Object.values(connStore.getAll())) {
        if (conn.workspaceId === body.workspaceId && (conn.options as any)?.functionsServer?.deploymentId) {
          deploymentId = (conn.options as any).functionsServer.deploymentId;
          break;
        }
      }
    }

    const template = serverEnv.FUNCTIONS_SERVER_URL_TEMPLATE;
    if (!template || !deploymentId) {
      res.status(503).json({
        error: {
          name: "FunctionRuntimeNotReady",
          message: "Function runtime for this workspace is being initialized. Please try again in a few minutes.",
        },
        result: { profile_id: "", traits: {}, updated_at: new Date() },
        store: {},
        logs: [],
      });
      return;
    }

    const baseUrl = template.replace("${workspaceId}", deploymentId);
    const url = `${baseUrl}/profileudfrun`;

    const response = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      bodyTimeout: 30000,
      headersTimeout: 30000,
      dispatcher: undiciAgent,
    });

    const result = (await response.body.json()) as any;

    if (result.error) {
      log
        .atError()
        .log(
          `Error running profile function: ${body?.id} workspace: ${body?.workspaceId}\n${result.error.name}: ${result.error.message}`
        );
    }
    res.json(result);
  } catch (e: any) {
    log.atError().log(`Failed to proxy profile UDF run: ${e.message}`);
    res.status(500).json({
      error: { name: e.name || "Error", message: e.message },
      result: { profile_id: "", traits: {}, updated_at: new Date() },
      store: {},
      logs: [],
    });
  }
};
