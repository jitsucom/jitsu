import { createRoute, verifyAccess } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { z } from "zod";
import { getLog, requireDefined, rpc } from "juava";
import { nangoConfig } from "../../../lib/server/oauth/nango-config";
import { fillDefaults, OauthDecorator, oauthDecorators } from "../../../lib/server/oauth/services";

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      serviceId: z.string(),
      integrationId: z.string().optional(),
    }),
  })
  .handler(async ({ req, query, user }) => {
    const object = await db.prisma().configurationObject.findFirst({
      where: { id: query.serviceId, deleted: false },
    });

    let credentials: any;
    let integrationId: string | undefined;
    let oauthDecorator: OauthDecorator;

    if (object) {
      await verifyAccess(user, object.workspaceId);
      credentials = {
        id: object.id,
        workspaceId: object.workspaceId,
        ...(object.config || ({} as any)),
      };
      const packageId = (object.config as any).packageId;
      oauthDecorator = requireDefined(
        oauthDecorators.map(fillDefaults).find(d => d.packageId === packageId),
        `Package ${packageId} for service ${query.serviceId} not found in catalog`
      );
      integrationId = oauthDecorator.nangoIntegrationId;
    } else {
      const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
      integrationId = requireDefined(
        query.integrationId,
        `integrationId is required if service (${query.serviceId}) is not found `
      );
      oauthDecorator = requireDefined(
        oauthDecorators.map(fillDefaults).find(d => d.nangoIntegrationId === integrationId),
        `Integration ${integrationId} not found in catalog`
      );
      if (!userProfile || !userProfile.admin) {
        throw new Error(`Access denied`);
      }
      credentials = {
        warning: `Service ${query.serviceId} not found in database`,
      };
    }
    // this code doesn't work because nango doesn't return secrets
    // const integrationSettings = await rpc(`${nangoConfig.nangoApiHost}/config/${integrationId}`, {
    //   headers: { Authorization: `Bearer ${nangoConfig.secretKey}` },
    // });
    const integrationSettings = {}; //todo - pull secrets from OauthSecrets table
    const nangoConnectionObject = await rpc(
      `${nangoConfig.nangoApiHost}/connection/sync-source.${query.serviceId}?provider_config_key=${integrationId}`,
      { headers: { Authorization: `Bearer ${nangoConfig.secretKey}` } }
    );

    getLog().atInfo().log("Integration settings", JSON.stringify(integrationSettings, null, 2));
    getLog().atInfo().log("Configuration object", JSON.stringify(nangoConnectionObject, null, 2));

    return {
      credentials: oauthDecorator.merge(credentials, integrationSettings, nangoConnectionObject.credentials),
    };
  })
  .toNextApiHandler();
