export type PackageId = `airbyte/${string}`;
/**
 * Decorates services with OAuth authentication
 */

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
  stripSchema(schema: any): any;
};

export function fillDefaults(dec: OauthDecorator): Required<OauthDecorator> {
  return {
    nangoIntegrationId: `jitsu-cloud-sync-${dec.nangoProvider}`,
    ...dec,
  };
}

export const github: OauthDecorator = {
  stripSchema(schema: any): any {
    return schema;
  },
  packageId: "airbyte/source-github",
  packageType: "airbyte",
  nangoProvider: "github",
  merge: (opts, integrationObj, connectionObj) => {
    return {
      ...opts,
      ...integrationObj,
      credentials: {
        access_token: connectionObj.access_token,
        option_title: "OAuth Credentials",
      },
    };
  },
};

export const oauthDecorators = [github];
