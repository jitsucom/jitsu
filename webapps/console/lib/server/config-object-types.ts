import type { PrismaClient, Workspace } from "@prisma/client";
import type { ConfigObjectType } from "../schema";
import { getConfigObjectType } from "../schema/config-objects";
import { supportsWarehouseReader } from "@jitsu/warehouse-query/src/schema";
import { rpc } from "juava";
import { ApiError } from "../shared/errors";
import { checkOrAddToIngress, isDomainAvailable } from "./custom-domains";
import { checkFunctionReferences, handleLinkedConnections } from "./config-object-delete";
import { eventDestinationError, ingestionDestinationError } from "./config-destination-validation";
import { domainClaimLock, modelMutationLock, MutationHooks } from "./config-object-lifecycle";
import { assertCustomDomainsAllowed } from "./plan-gate";
import { getEeServerConnection, isEEAvailable, serviceTokenHeaders } from "./ee";
import { getServerLog } from "./log";
import {
  guardModelReferences,
  guardReverseDeliveryChanges,
  recheckModelWarehouse,
  validateModelForSave,
} from "./reverse-etl-models";

type TestValidationContext<T> = { prisma: PrismaClient; workspace: Workspace; object: T };

/** Server extension: schemas and serialization stay independent of mutation orchestration. */
export type ServerConfigObjectType<T = any, Prepared = any> = Required<ConfigObjectType<T>> & {
  mutation: MutationHooks<T, Prepared>;
  /** Explicit side effects for the connection-test API, after its access/entitlement checks. */
  afterTestValidation?: (ctx: TestValidationContext<T>) => Promise<void>;
};

const log = getServerLog("config-object-types");

function domainHooks(type: "stream" | "domain", domains: (obj: any) => string[]): MutationHooks {
  return {
    prepare: async ctx => {
      if (ctx.operation !== "delete") {
        await assertCustomDomainsAllowed(ctx.user, ctx.workspace, type, ctx.next, ctx.previous, ctx.req);
      }
    },
    lockKeys: ctx => (ctx.operation !== "delete" && domains(ctx.next).length ? [domainClaimLock] : []),
    beforeWrite: async ctx => {
      if (ctx.operation === "delete") return;
      // Recheck after acquiring the global claim lock; the earlier input filter is only a fast rejection.
      for (const domain of domains(ctx.next)) {
        if (!(await isDomainAvailable(domain, ctx.workspace, ctx.tx)).available) {
          throw new ApiError(`Domain ${domain} is already in use by other workspace`);
        }
      }
    },
  };
}

const streamDomains = domainHooks("stream", obj => obj.domains ?? []);

async function provisionStreamDomains({ prisma, workspace, object }: TestValidationContext<any>) {
  if (!object.domains?.length) return;
  const domainObjects = await prisma.configurationObject.findMany({
    where: { workspaceId: workspace.id, deleted: false, type: "domain", workspace: { deleted: false } },
  });
  const wildcards = domainObjects.map(obj => (obj.config as any).name).filter(name => name?.startsWith("*"));
  for (const domain of object.domains) {
    if (wildcards.some(wildcard => domain.endsWith(wildcard.toLowerCase().replace("*", "")))) continue;
    try {
      const status = await checkOrAddToIngress(domain);
      log.atInfo().log(`Ingress status for ${domain}: ${JSON.stringify(status)}`);
    } catch (e) {
      log.atError().withCause(e).log(`Error checking ingress status for ${domain}`);
    }
  }
}

const modelHooks: MutationHooks<any, Awaited<ReturnType<typeof validateModelForSave>> | undefined> = {
  prepare: ctx =>
    ctx.operation === "delete"
      ? Promise.resolve(undefined)
      : validateModelForSave(ctx.prisma, ctx.workspace.id, ctx.next),
  lockKeys: ctx => [modelMutationLock(ctx.workspace.id)],
  beforeWrite: async (ctx, inspectedWarehouse) => {
    if (ctx.operation === "delete") {
      await guardModelReferences(ctx.tx, ctx.workspace.id, ctx.id, "model");
    } else {
      if (ctx.operation === "update") {
        await guardReverseDeliveryChanges(ctx.tx, ctx.workspace.id, ctx.id, "model");
      }
      await recheckModelWarehouse(ctx.tx, ctx.workspace.id, ctx.next.warehouseId, inspectedWarehouse);
    }
  },
};

const destinationHooks: MutationHooks = {
  lockKeys: ctx => [modelMutationLock(ctx.workspace.id)],
  beforeWrite: async ctx => {
    const { tx, id, workspace } = ctx;
    const workspaceId = workspace.id;
    if (ctx.operation === "delete") {
      await guardModelReferences(tx, workspaceId, id, "destination");
      await handleLinkedConnections(workspaceId, id, "destination", tx, ctx.options);
    } else if (ctx.operation === "update") {
      await guardReverseDeliveryChanges(tx, workspaceId, id, "destination");
      // Compare the current row under the lock, not the snapshot taken before merge/validation.
      const current = await tx.configurationObject.findFirstOrThrow({
        where: { id, workspaceId, type: "destination", deleted: false },
      });
      const ingestionError = ingestionDestinationError(ctx.next);
      if (
        ingestionError &&
        (await tx.configurationObjectLink.count({
          where: { workspaceId, toId: id, deleted: false, OR: [{ type: { in: ["push", "sync"] } }, { type: null }] },
        })) > 0
      )
        throw ingestionError;
      const eventError = eventDestinationError(ctx.next);
      if (
        eventError &&
        (await tx.configurationObjectLink.count({
          where: { workspaceId, toId: id, deleted: false, from: { type: "stream" } },
        })) > 0
      )
        throw eventError;
      if (!supportsWarehouseReader(ctx.next) || ctx.next.destinationType !== (current.config as any).destinationType) {
        await guardModelReferences(tx, workspaceId, id, "destination");
      }
    }
  },
};

const serverTypes: Record<string, Pick<ServerConfigObjectType, "mutation" | "afterTestValidation">> = {
  model: { mutation: modelHooks },
  destination: { mutation: destinationHooks },
  domain: { mutation: domainHooks("domain", obj => [obj.name]) },
  stream: {
    mutation: {
      ...streamDomains,
      beforeWrite: async ctx => {
        if (ctx.operation === "delete") {
          await handleLinkedConnections(ctx.workspace.id, ctx.id, "stream", ctx.tx, ctx.options);
        } else {
          await streamDomains.beforeWrite?.(ctx, undefined);
        }
      },
      afterCommit: async ctx => {
        if (ctx.operation === "delete") return;
        // Ingress is best-effort and happens only once the domain claim has committed.
        try {
          await provisionStreamDomains({ ...ctx, object: ctx.next });
        } catch (e) {
          log.atWarn().withCause(e).log(`Failed to provision stream domains for workspace ${ctx.workspace.id}`);
        }
        if (ctx.operation === "create" && isEEAvailable()) {
          // The hourly backup-retention-sync job is the backstop for bucket provisioning.
          await rpc(`${getEeServerConnection().host}api/s3-init?workspaceId=${encodeURIComponent(ctx.workspace.id)}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", ...serviceTokenHeaders() },
            signal: AbortSignal.timeout(5_000),
          });
        }
      },
    },
    afterTestValidation: provisionStreamDomains,
  },
  service: {
    mutation: {
      beforeWrite: async ctx => {
        if (ctx.operation === "delete") {
          await handleLinkedConnections(ctx.workspace.id, ctx.id, "service", ctx.tx, ctx.options);
        }
      },
    },
  },
  function: {
    mutation: {
      beforeWrite: async ctx => {
        if (ctx.operation === "delete") {
          await checkFunctionReferences(ctx.tx, { id: ctx.id, workspaceId: ctx.workspace.id }, ctx.options);
        }
      },
    },
  },
};

export function getServerConfigObjectType(type: string): ServerConfigObjectType {
  const serverType = Object.prototype.hasOwnProperty.call(serverTypes, type) ? serverTypes[type] : undefined;
  return { ...getConfigObjectType(type), mutation: {}, ...serverType };
}
