export type OptionsObject = Record<string, any>;

export type OauthDecorator = {
  /**
   * ID of the package. Same as ConnectorPackage.packageId
   */
  destinationType: string;

  /**
   * Provider id for nango (github, googlesheets, etc). See https://github.com/NangoHQ/nango/blob/master/packages/shared/providers.yaml
   */
  nangoProvider: (cred: any) => string;

  /**
   * Integration id for nango.
   */
  nangoIntegrationId: (cred: any) => string;
};

export const oauthDecorators: Record<string, OauthDecorator> = {
  salesforce: {
    destinationType: "salesforce",
    nangoProvider: cred => (cred.isSandbox ? "salesforce-sandbox" : "salesforce"),
    nangoIntegrationId: cred => (cred.isSandbox ? "jitsu-cloud-dst-salesforce-sandbox" : "jitsu-cloud-dst-salesforce"),
  },
};
