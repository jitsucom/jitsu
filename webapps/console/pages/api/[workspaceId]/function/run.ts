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

// Class priority order: premium > dedicated > free
const classPriority = ["premium", "dedicated", "free"];

async function getDeploymentId(workspaceId: string): Promise<string | undefined> {
  const records = await db.prisma().functionsServer.findMany({
    where: { workspaceId },
    select: { class: true, deploymentId: true },
  });
  if (records.length === 0) {
    return undefined;
  }
  // Select highest priority class
  for (const cls of classPriority) {
    const record = records.find(r => r.class === cls);
    if (record?.deploymentId) {
      return record.deploymentId;
    }
  }
  return undefined;
}

function getUdfRunUrl(deploymentId: string, serverEnv: ReturnType<typeof getServerEnv>): string {
  const template = serverEnv.FUNCTIONS_SERVER_URL_TEMPLATE;
  if (!template) {
    const rotorURL = requireDefined(
      serverEnv.ROTOR_URL,
      `env ROTOR_URL is not set. Rotor is required to run functions`
    );
    return rotorURL + "/udfrun";
  }
  const baseUrl = template.replace("${workspaceId}", deploymentId);
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

      const deploymentId = await getDeploymentId(workspaceId);
      if (!deploymentId) {
        return resultType.parse({
          error: {
            name: "FunctionRuntimeNotReady",
            message:
              "Function runtime for this workspace is being initialized. Please try again in a few minutes. If this message persists, please contact support.",
          },
          store: {},
          logs: [],
        });
      }
      const url = getUdfRunUrl(deploymentId, serverEnv);

      log
        .atInfo()
        .log(
          `Running function ${body.functionId} for workspace ${workspaceId} via ${url} (deployment: ${deploymentId})`
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
