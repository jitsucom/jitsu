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

const github: OauthDecorator = {
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

const _googleBase: Omit<OauthDecorator, "packageId"> = {
  stripSchema: (schema: any) => {
    return {
      ...schema,
      credentials: {
        access_token: JITSU_MANAGED,
        refresh_token: JITSU_MANAGED,
        client_id: JITSU_MANAGED,
        client_secret: JITSU_MANAGED,
        auth_type: "Client",
      },
    };
  },
  packageType: "airbyte",
  nangoProvider: "google",
  merge: (opts, integrationObj, connectionObj) => {
    const mCred = { ...opts.credentials };
    if (mCred.auth_type === "Client") {
      mCred.access_token = manage(mCred.access_token, connectionObj.access_token);
      mCred.refresh_token = manage(mCred.refresh_token, connectionObj.refresh_token);
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

const googleAnalytics: OauthDecorator = {
  ..._googleBase,
  packageId: "airbyte/source-google-analytics-v4",
  nangoIntegrationId: "jitsu-cloud-sync-google-analytics",
};

const googleAnalyticsGA4: OauthDecorator = {
  ..._googleBase,
  packageId: "airbyte/source-google-analytics-data-api",
  nangoIntegrationId: "jitsu-cloud-sync-google-analytics",
};

const googleAds: OauthDecorator = {
  ..._googleBase,
  stripSchema: (schema: any) => {
    return {
      ...schema,
      credentials: {
        access_token: JITSU_MANAGED,
        refresh_token: JITSU_MANAGED,
        developer_token: JITSU_MANAGED,
        client_id: JITSU_MANAGED,
        client_secret: JITSU_MANAGED,
      },
    };
  },
  merge: (opts, integrationObj, connectionObj) => {
    const mCred = { ...opts.credentials };
    mCred.developer_token = manage(mCred.developer_token, process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "");
    mCred.access_token = manage(mCred.access_token, connectionObj.access_token);
    mCred.refresh_token = manage(mCred.refresh_token, connectionObj.refresh_token);
    mCred.client_id = manage(mCred.client_id, integrationObj.clientId);
    mCred.client_secret = manage(mCred.client_secret, integrationObj.clientSecret);
    return {
      ...opts,
      credentials: {
        ...opts.credentials,
        ...mCred,
      },
    };
  },
  packageId: "airbyte/source-google-ads",
  nangoIntegrationId: "jitsu-cloud-sync-google-ads",
};

const googleSheets: OauthDecorator = {
  ..._googleBase,
  packageId: "airbyte/source-google-sheets",
  nangoIntegrationId: "jitsu-cloud-sync-google-sheets",
};

const facebookMarketing: OauthDecorator = {
  stripSchema: (schema: any) => {
    return {
      ...schema,
      access_token: JITSU_MANAGED,
      client_id: JITSU_MANAGED,
      client_secret: JITSU_MANAGED,
    };
  },
  packageId: "airbyte/source-facebook-marketing",
  packageType: "airbyte",
  nangoProvider: "facebook",
  nangoIntegrationId: "jitsu-cloud-sync-facebook",
  merge: (opts, integrationObj, connectionObj) => {
    const mCred = { ...opts };
    mCred.access_token = manage(mCred.access_token, connectionObj.access_token);
    mCred.client_id = manage(mCred.client_id, integrationObj.clientId);
    mCred.client_secret = manage(mCred.client_secret, integrationObj.clientSecret);
    return mCred;
  },
};

export const oauthDecorators = [
  github,
  googleAnalytics,
  googleAnalyticsGA4,
  googleAds,
  googleSheets,
  facebookMarketing,
].map(fillDefaults);
