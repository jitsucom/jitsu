import type { PrismaClient } from "@prisma/client";
import { getErrorMessage, randomId, requireDefined, rpc } from "juava";
import { SessionUser } from "../schema";
import { verifyAccess, verifyAccessWithRole } from "../api";
import { ApiError } from "../shared/errors";
import { getConfigObjectType, parseObject } from "../schema/config-objects";
import { containsMaskedSecrets, unmaskSecretsFromOriginal } from "../schema/secrets";
import { httpAgent, httpsAgent } from "./http-agent";
import { getServerEnv } from "./serverEnv";
import { getServerLog } from "./log";

const log = getServerLog("debug-service");

export interface DebugServiceDeps {
  prisma: PrismaClient;
}

// Class priority order: premium > dedicated > free (same as function/run.ts).
const classPriority = ["premium", "dedicated", "free"];

export type FunctionRunResult = {
  error?: { name: string; message: string; stack?: string; retryPolicy?: any };
  dropped?: boolean;
  result?: any;
  store: Record<string, any>;
  logs: any[];
  meta?: any;
  backend?: string;
};

const runtimeNotReady = (what: string): FunctionRunResult => ({
  error: {
    name: "FunctionRuntimeNotReady",
    message: `${what} for this workspace is being initialized. Please try again in a few minutes. If this message persists, please contact support.`,
  },
  store: {},
  logs: [],
});

/**
 * Test/debug operations extracted from `config/[type]/test.ts` (bulker credential test),
 * `function/run.ts`, and `profile-builder/run.ts` so the MCP server shares one implementation
 * of secret unmasking, input filtering, and functions-server dispatch. When `code` isn't
 * supplied, the run methods load the stored draft/code of the referenced function so an agent
 * can exercise what's deployed without round-tripping the source.
 */
export class DebugService {
  private readonly prisma: PrismaClient;

  constructor(deps: DebugServiceDeps) {
    this.prisma = deps.prisma;
  }

  /**
   * Synchronous credential test via bulker `/test` (mirrors `config/[type]/test.ts`). Either
   * pass a full `config` (masked secrets are unmasked from the stored object referenced by
   * `config.id`/`config.cloneId`) or just `id` to test an existing object as stored.
   */
  async testConnection(
    user: SessionUser,
    workspaceId: string,
    type: string,
    opts: { config?: any; id?: string }
  ): Promise<any> {
    await verifyAccess(user, workspaceId);
    const serverEnv = getServerEnv();
    const bulkerURLEnv = requireDefined(serverEnv.BULKER_URL, "env BULKER_URL is not defined");
    const bulkerAuthKey = serverEnv.BULKER_AUTH_KEY ?? "";
    const isHttps = bulkerURLEnv.startsWith("https://");
    const workspace = requireDefined(
      await this.prisma.workspace.findFirst({ where: { id: workspaceId } }),
      `Workspace ${workspaceId} not found`
    );
    let body = opts.config;
    if (!body) {
      const id = requireDefined(opts.id, "either `config` or `id` must be provided");
      const existing = await this.prisma.configurationObject.findFirst({
        where: { id, workspaceId, type, deleted: false },
      });
      if (!existing) {
        throw new ApiError(`${type} with id ${id} does not exist`, { status: 404 });
      }
      body = { ...(existing.config as any), id };
    }
    body = { ...body, workspaceId, type, id: body.id ?? randomId() };
    const configObjectType = getConfigObjectType(type);
    let object = parseObject(type, body);
    if (containsMaskedSecrets(object)) {
      const existingEntity = await this.prisma.configurationObject.findFirst({
        where: { id: body.cloneId || body.id, workspaceId },
      });
      if (existingEntity?.config) {
        log.atInfo().log(`Unmasking secrets for ${type} test: ${body.id}`);
        object = unmaskSecretsFromOriginal(object, existingEntity.config as any);
      }
    }
    object = await configObjectType.inputFilter(object, "create", workspace);

    const options: any = {
      method: "POST",
      agent: (isHttps ? httpsAgent : httpAgent)(),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(object),
    };
    if (bulkerAuthKey) {
      options.headers["Authorization"] = `Bearer ${bulkerAuthKey}`;
    }
    try {
      const response = await fetch(bulkerURLEnv + "/test", options);
      return await response.json();
    } catch (e) {
      throw new ApiError(`failed to fetch bulker API: ${getErrorMessage(e)}`, { status: 500 });
    }
  }

  /** Mirrors `function/run.ts`. `code` omitted → the stored function's draft (falls back to code). */
  async runFunction(
    user: SessionUser,
    workspaceId: string,
    opts: {
      functionId: string;
      functionName?: string;
      code?: string;
      event: any;
      variables?: any;
      store?: any;
      userAgent?: string;
    }
  ): Promise<FunctionRunResult> {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    let code = opts.code;
    let functionName = opts.functionName;
    if (code === undefined) {
      const func = await this.prisma.configurationObject.findFirst({
        where: { id: opts.functionId, workspaceId, type: "function", deleted: false },
      });
      if (!func) {
        throw new ApiError(`function with id ${opts.functionId} does not exist`, { status: 404 });
      }
      const cfg = func.config as any;
      code = requireDefined(cfg.draft ?? cfg.code, `function ${opts.functionId} has no code`);
      functionName = cfg.name;
    }
    const deploymentId = await this.getDeploymentId(workspaceId);
    if (!deploymentId) {
      return runtimeNotReady("Function runtime");
    }
    const url = this.functionsServerUrl(deploymentId, "/udfrun");
    log.atInfo().log(`Running function ${opts.functionId} for workspace ${workspaceId} via ${url}`);
    return await rpc(url, {
      method: "POST",
      body: {
        functionId: opts.functionId,
        functionName,
        code,
        event: opts.event,
        variables: opts.variables ?? {},
        store: opts.store ?? {},
        userAgent: opts.userAgent,
        workspaceId,
      },
      headers: this.rotorAuthHeaders(),
    });
  }

  /**
   * Mirrors `profile-builder/run.ts`. `code`/`settings`/`version` omitted → loaded from the
   * stored profile builder (its function's draft/code and `connectionOptions`).
   */
  async runProfileBuilder(
    user: SessionUser,
    workspaceId: string,
    opts: {
      profileBuilderId: string;
      events: any[];
      code?: string;
      settings?: any;
      version?: number;
      store?: any;
      userAgent?: string;
    }
  ): Promise<FunctionRunResult> {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    const pb = await this.prisma.profileBuilder.findFirst({
      where: { id: opts.profileBuilderId, workspaceId, deleted: false },
      include: { functions: { include: { function: true } } },
    });
    if (!pb) {
      throw new ApiError(`profile builder with id ${opts.profileBuilderId} does not exist`, { status: 404 });
    }
    let code = opts.code;
    if (code === undefined) {
      const funcConfig = pb.functions[0]?.function?.config as any;
      code = requireDefined(
        funcConfig?.draft ?? funcConfig?.code,
        `profile builder ${opts.profileBuilderId} has no function code — pass \`code\` explicitly`
      );
    }
    const deploymentId = await this.getDeploymentId(workspaceId);
    if (!deploymentId) {
      return runtimeNotReady("Profile builder runtime");
    }
    const url = this.profileBuilderRunUrl(deploymentId);
    log.atInfo().log(`Running profile builder ${opts.profileBuilderId} for workspace ${workspaceId} via ${url}`);
    return await rpc(url, {
      method: "POST",
      body: {
        id: pb.id,
        name: pb.name,
        version: opts.version ?? pb.version,
        code,
        events: opts.events,
        settings: opts.settings ?? pb.connectionOptions ?? {},
        store: opts.store ?? {},
        userAgent: opts.userAgent,
        workspaceId,
      },
      headers: this.rotorAuthHeaders(),
    });
  }

  /** Highest-priority functions-server deployment for the workspace (premium > dedicated > free). */
  private async getDeploymentId(workspaceId: string): Promise<string | undefined> {
    const records = await this.prisma.functionsServer.findMany({
      where: { workspaceId },
      select: { class: true, deploymentId: true },
    });
    for (const cls of classPriority) {
      const record = records.find(r => r.class === cls);
      if (record?.deploymentId) {
        return record.deploymentId;
      }
    }
    return undefined;
  }

  private functionsServerUrl(deploymentId: string, path: string): string {
    const template = requireDefined(
      getServerEnv().FUNCTIONS_SERVER_URL_TEMPLATE,
      "env FUNCTIONS_SERVER_URL_TEMPLATE is not set. Functions server is required to run functions"
    );
    return template.replace("${workspaceId}", deploymentId) + path;
  }

  // profile-builder/run.ts keeps a ROTOR_URL fallback for installations without
  // per-workspace functions servers — preserve it.
  private profileBuilderRunUrl(deploymentId: string): string {
    const serverEnv = getServerEnv();
    if (!serverEnv.FUNCTIONS_SERVER_URL_TEMPLATE) {
      const rotorURL = requireDefined(
        serverEnv.ROTOR_URL,
        `env ROTOR_URL is not set. Rotor is required to run functions`
      );
      return rotorURL + "/profileudfrun";
    }
    return this.functionsServerUrl(deploymentId, "/profileudfrun");
  }

  private rotorAuthHeaders(): Record<string, string> {
    const rotorAuthKey = getServerEnv().ROTOR_AUTH_KEY;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (rotorAuthKey) {
      headers["Authorization"] = `Bearer ${rotorAuthKey}`;
    }
    return headers;
  }
}
