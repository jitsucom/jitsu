import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { getServerLog } from "../../../../../lib/server/log";
import { assertTrue, requireDefined, rpc } from "juava";
import { createJwt, getEeConnection, isEEAvailable } from "../../../../../lib/server/ee";
import { db } from "../../../../../lib/server/db";
import { DestinationConfig } from "../../../../../lib/schema";

const log = getServerLog("provision-db");

export async function findProvisionedDestination(workspaceId) {
  const allDestinations = await db.prisma().configurationObject.findMany({
    where: { workspaceId: workspaceId, type: "destination", deleted: false },
  });

  return allDestinations
    .map(row =>
      DestinationConfig.parse({ ...(row.config as any), workspaceId: row.workspaceId, id: row.id, type: row.type })
    )
    .find(dest => dest.destinationType === "clickhouse" && dest.provisioned === true);
}

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({
        workspaceId: z.string(),
      }),
      result: z.object({
        provisioned: z.boolean(),
        config: DestinationConfig.optional(),
        destinationId: z.string().optional(),
      }),
    },
    handle: async ({ user, query }) => {
      assertTrue(isEEAvailable(), `EE server URL is not set, DB can't be provisioned`);
      const { workspaceId } = query;
      await verifyAccess(user, workspaceId);
      const provisionedDestination = await findProvisionedDestination(workspaceId);
      return provisionedDestination
        ? { provisioned: true, destinationId: provisionedDestination.id, config: provisionedDestination }
        : { provisioned: false };
    },
  },
  POST: {
    auth: true,
    types: {
      query: z.object({
        workspaceId: z.string(),
      }),
      result: z.object({
        destinationId: z.string(),
        config: DestinationConfig.optional(),
      }),
    },
    handle: async ({ user, query }) => {
      assertTrue(isEEAvailable(), `EE server URL is not set, DB can't be provisioned`);
      const { workspaceId } = query;
      await verifyAccess(user, workspaceId);
      const provisionedDestination = await findProvisionedDestination(workspaceId);

      if (provisionedDestination) {
        return { destinationId: provisionedDestination.id, config: provisionedDestination };
      }
      const workspace = requireDefined(
        await db.prisma().workspace.findUnique({ where: { id: workspaceId } }),
        `Workspace ${workspaceId} not found`
      );

      const url = `${getEeConnection().host}api/provision-db`;
      const provisionedDbCredentials = await rpc(url, {
        method: "POST",
        query: { workspaceId, slug: workspace.slug || workspace.id },
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${createJwt(user.internalId, user.email, workspaceId, 60).jwt}`,
        },
      });
      const provisionedDb = await db.prisma().configurationObject.create({
        data: {
          workspaceId,
          type: "destination",
          config: {
            name: "Provisioned Clickhouse",
            destinationType: "clickhouse",
            provisioned: true,
            ...provisionedDbCredentials,
          },
        },
      });
      return {
        destinationId: provisionedDb.id,
        config: {
          id: provisionedDb.id,
          type: provisionedDb.type,
          workspaceId: provisionedDb.workspaceId,
          ...(provisionedDb.config as any),
        },
      };
    },
  },
};

export default nextJsApiHandler(api);
