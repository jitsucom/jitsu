import { ServiceConfig } from "../../schema";
import { rpc } from "juava";
import { getAppEndpoint } from "../../domains";
import { NextApiRequest } from "next";

export type PackageId = `airbyte/${string}`;
/**
 * Decorates services with OAuth authentication
 */

export const JITSU_MANAGED = "JITSU_MANAGED";

// If service supports Jitsu OAuth - returns decorated credentials part of service config
// otherwise returns original credentials part of config
export const tryManageOauthCreds = async (service: ServiceConfig, req: NextApiRequest): Promise<any> => {
  const oauthConnector = oauthDecorators.find(d => d.packageId === service.package);
  if (oauthConnector && service.authorized) {
    return await rpc(
      `${getAppEndpoint(req).baseUrl}/api/oauth/service?package=${service.package}&serviceId=${service.id}`,
      {
        headers: {
          Authorization: req.headers.authorization ?? "",
          Cookie: req.headers.cookie ?? "",
        },
        body: service.credentials,
      }
    );
  } else {
    return JSON.parse(service.credentials);
  }
};

function manage(original: string, provided: string) {
  if (original === JITSU_MANAGED) {
    return provided;
  } else {
    return original;
  }
}

export type OptionsObject = Record<string, any>;

export type OauthDecorator = {
  /**
   * ID of the package. Same as ConnectorPackage.packageId
   */
  packageId: PackageId;
  /**
   * Type of the package. Same as ConnectorPackage.packageType
   */
  packageType: "airbyte";

  /**
   * Provider id for nango (github, googlesheets, etc). See https://github.com/NangoHQ/nango/blob/master/packages/shared/providers.yaml
   */
  nangoProvider: string;

  /**
   * Integration id for nango. If not set, `jitsu-cloud-sync-${nangoProvider}`
   */
  nangoIntegrationId?: string;

  /**
   * @param original connector config, as defined by airbyte
   * @param integrationObj nango integration object, it usually contains client id and secret, sometimes scopes
   * @param connectionObj connection object, containing auth and refresh tokens
   */
  merge: (opts: OptionsObject, integrationObj: OptionsObject, connectionObj: OptionsObject) => OptionsObject;

  /**
   * Removes credentials fields from schema
   * @param schema
   */
  stripSchema: (schema: any) => any;
};

function fillDefaults(dec: OauthDecorator): Required<OauthDecorator> {
  return {
    nangoIntegrationId: `jitsu-cloud-sync-${dec.nangoProvider}`,
    ...dec,
  };
}

export const github: OauthDecorator = {
  stripSchema: (schema: any) => {
    return {
      ...schema,
      credentials: {
        access_token: JITSU_MANAGED,
        client_id: JITSU_MANAGED,
        client_secret: JITSU_MANAGED,
        option_title: "OAuth Credentials",
      },
    };
  },
  packageId: "airbyte/source-github",
  packageType: "airbyte",
  nangoProvider: "github",
  merge: (opts, integrationObj, connectionObj) => {
    const mCred = { ...opts.credentials };
    if (mCred.option_title === "OAuth Credentials") {
      mCred.access_token = manage(mCred.access_token, connectionObj.access_token);
      mCred.client_id = manage(mCred.client_id, integrationObj.clientId);
      mCred.client_secret = manage(mCred.client_secret, integrationObj.clientSecret);
    }
    return {
      ...opts,
      credentials: {
        ...opts.credentials,
        ...mCred,
      },
    };
  },
};

export const oauthDecorators = [github].map(fillDefaults);
