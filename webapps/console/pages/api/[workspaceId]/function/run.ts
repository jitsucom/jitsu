import { getServerLog } from "../../../../lib/server/log";
import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccessWithRole } from "../../../../lib/api";
import { requireDefined, rpc } from "juava";
import { getServerEnv } from "../../../../lib/server/serverEnv";
import { db } from "../../../../lib/server/db";

const log = getServerLog("function-run");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb", // Set desired value here
    },
  },
};

const resultType = z.object({
  error: z
    .object({ name: z.string(), message: z.string(), stack: z.string().optional(), retryPolicy: z.any().optional() })
    .optional(),
  dropped: z.boolean().optional(),
  result: z.any().nullish(),
  store: z.record(z.any()),
  logs: z.array(z.any()),
  meta: z.any().nullish(),
  backend: z.string().optional(),
});

export type FunctionRunType = z.infer<typeof resultType>;

function extractFunctionsClasses(featuresEnabled: string[], defaultClass: string): string[] {
  const prefix = "functionsClasses=";
  for (const feature of featuresEnabled) {
    if (feature.startsWith(prefix)) {
      return feature
        .substring(prefix.length)
        .split(",")
        .map(f => f.trim());
    }
  }
  return [defaultClass];
}

function getUdfRunUrl(
  workspaceId: string,
  functionsClasses: string[],
  serverEnv: ReturnType<typeof getServerEnv>
): string {
  const template = serverEnv.FUNCTIONS_SERVER_URL_TEMPLATE;
  const isLegacy = functionsClasses.includes("legacy") || functionsClasses.includes("");
  if (!template || isLegacy) {
    const rotorURL = requireDefined(
      serverEnv.ROTOR_URL,
      `env ROTOR_URL is not set. Rotor is required to run functions`
    );
    return rotorURL + "/udfrun";
  }
  const functionsClass = functionsClasses[0];
  const baseUrl = template.replace("${workspaceId}", functionsClass === "free" ? "free" : workspaceId);
  return baseUrl + "/udfrun";
}

export const api: Api = {
  url: inferUrl(__filename),
  POST: {
    auth: true,
    types: {
      query: z.object({
        workspaceId: z.string(),
      }),
      body: z.object({
        functionId: z.string(),
        functionName: z.string().optional(),
        code: z.string(),
        event: z.any(),
        variables: z.any(),
        store: z.any(),
        userAgent: z.string().optional(),
      }),
      result: resultType,
    },
    handle: async ({ user, query, body }) => {
      const { workspaceId } = query;
      await verifyAccessWithRole(user, workspaceId, "editEntities");
      const serverEnv = getServerEnv();

      const workspace = await db.prisma().workspace.findFirst({
        where: { id: workspaceId },
        select: { featuresEnabled: true },
      });
      const functionsClasses = extractFunctionsClasses(
        workspace?.featuresEnabled ?? [],
        serverEnv.DEFAULT_FUNCTIONS_CLASS
      );
      const url = getUdfRunUrl(workspaceId, functionsClasses, serverEnv);

      log
        .atInfo()
        .log(
          `Running function ${
            body.functionId
          } for workspace ${workspaceId} via ${url} (classes: ${functionsClasses.join(",")})`
        );

      const rotorAuthKey = serverEnv.ROTOR_AUTH_KEY;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (rotorAuthKey) {
        headers["Authorization"] = `Bearer ${rotorAuthKey}`;
      }

      const res = await rpc(url, {
        method: "POST",
        body: {
          ...body,
          workspaceId,
        },
        headers,
      });
      return resultType.parse(res);
    },
  },
};

export default nextJsApiHandler(api);
