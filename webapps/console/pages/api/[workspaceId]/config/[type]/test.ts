import { createRoute, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { getServerLog } from "../../../../../lib/server/log";
import { ApiError } from "../../../../../lib/shared/errors";
import { getConfigObjectType, parseObject } from "../../../../../lib/schema/config-objects";
import { httpAgent, httpsAgent } from "../../../../../lib/server/http-agent";
import { getErrorMessage, requireDefined } from "juava";
import { db } from "../../../../../lib/server/db";
import { unmaskSecretsFromOriginal, containsMaskedSecrets } from "../../../../../lib/schema/secrets";
import { getServerEnv } from "../../../../../lib/server/serverEnv";

const log = getServerLog("test-connection");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

export const route = createRoute()
  .POST({
    auth: true,
    query: z.object({ type: z.string(), workspaceId: z.string() }),
    body: z.any(),
    result: z.any(),
    summary: "Test connection",
    tags: ["config"],
  })
  .handler(async ({ user, body, query }) => {
    log.atDebug().log("POST", JSON.stringify({ body, query }, null, 2));
    const serverEnv = getServerEnv();
    const bulkerURLEnv = requireDefined(serverEnv.BULKER_URL, "env BULKER_URL is not defined");
    const bulkerAuthKey = serverEnv.BULKER_AUTH_KEY ?? "";
    const isHttps = bulkerURLEnv.startsWith("https://");
    const { workspaceId, type } = query;
    await verifyAccess(user, workspaceId);
    const workspace = requireDefined(
      await db.prisma().workspace.findFirst({ where: { id: workspaceId } }),
      `Workspace ${workspaceId} not found`
    );
    const configObjectTypes = getConfigObjectType(type);
    let object = parseObject(type, body);
    if (containsMaskedSecrets(object)) {
      const existingEntity = await db.prisma().configurationObject.findFirst({
        where: { id: body.cloneId || body.id, workspaceId },
      });
      if (existingEntity?.config) {
        log.atInfo().log(`Unmasking secrets for ${type} test: ${body.id}`);
        const dbConfig = existingEntity.config as any;
        object = unmaskSecretsFromOriginal(object, dbConfig);
      }
    }
    object = await configObjectTypes.inputFilter(object, "create", workspace);

    const payload = JSON.stringify(object);
    log.atDebug().log("payload", payload);
    const options = {
      method: "POST",
      agent: (isHttps ? httpsAgent : httpAgent)(),
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
    };
    if (bulkerAuthKey) {
      options.headers["Authorization"] = `Bearer ${bulkerAuthKey}`;
    }
    try {
      const response = await fetch(bulkerURLEnv + "/test", options);
      const json = await response.json();
      log.atInfo().log(`StatusCode: ${response.status} Response Body: ${JSON.stringify(json)}`);
      return json;
    } catch (e) {
      throw new ApiError(`failed to fetch bulker API: ${getErrorMessage(e)}`, {}, { status: 500 });
    }
  });

export default route.toNextApiHandler();
