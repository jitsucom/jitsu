import { createRoute, verifyAccess } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { z } from "zod";
import { assertDefined, getLog, requireDefined, rpc } from "juava";
import { nangoConfig } from "../../../lib/server/oauth/nango-config";
import { OauthDecorator, oauthDecorators } from "../../../lib/server/oauth/services";

export default createRoute()
  .POST({
    auth: true,
    body: z.object({}).passthrough(),
    query: z.object({
      serviceId: z.string().optional(),
      package: z.string().optional(),
      integrationId: z.string().optional(),
    }),
  })
  .handler(async ({ req, query, user, body }) => {
    let credentials: any;
    let integrationId: string | undefined;
    let oauthDecorator: OauthDecorator;

    // we need that because we work with unsaved objects (new or edited) - body represents credentials from the form
    if (body) {
      credentials = body;
      oauthDecorator = requireDefined(
        oauthDecorators.find(d => d.packageId === query.package),
        `Package ${query.package} for service ${query.serviceId} not found in catalog`
      );
      integrationId = oauthDecorator.nangoIntegrationId;
    } else if (query.serviceId) {
      const object = await db.prisma().configurationObject.findFirst({
        where: { id: query.serviceId, deleted: false },
      });
      assertDefined(object, `Service ${query.serviceId} not found in database`);
      await verifyAccess(user, object.workspaceId);
      credentials = (object.config as any).credentials;
      const packageId = (object.config as any).package;
      oauthDecorator = requireDefined(
        oauthDecorators.find(d => d.packageId === packageId),
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
        oauthDecorators.find(d => d.nangoIntegrationId === integrationId),
        `Integration ${integrationId} not found in catalog`
      );
      if (!userProfile || !userProfile.admin) {
        throw new Error(`Access denied`);
      }
      credentials = {
        warning: `Service ${query.serviceId} not found in database`,
      };
    }
    const integrationSettings = await rpc(`${nangoConfig.nangoApiHost}/config/${integrationId}?include_creds=true`, {
      headers: { Authorization: `Bearer ${nangoConfig.secretKey}` },
    });
    const nangoConnectionObject = await rpc(
      `${nangoConfig.nangoApiHost}/connection/sync-source.${query.serviceId}?provider_config_key=${integrationId}&refresh_token=true`,
      { headers: { Authorization: `Bearer ${nangoConfig.secretKey}` } }
    );

    getLog().atInfo().log("Integration settings", JSON.stringify(integrationSettings, null, 2));
    getLog().atInfo().log("Configuration object", JSON.stringify(nangoConnectionObject, null, 2));

    return oauthDecorator.merge(credentials, integrationSettings.config, nangoConnectionObject.credentials);
  })
  .toNextApiHandler();
