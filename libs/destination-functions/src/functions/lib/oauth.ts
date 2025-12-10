import { rpc } from "juava";
import { nangoConfig } from "./nango-config";

export const getOauthCreds = async (integrationId: string, connectionId: string): Promise<any> => {
  if (nangoConfig.enabled) {
    const nangoConnectionObject = await rpc(
      `${nangoConfig.nangoApiHost}/connection/${connectionId}?provider_config_key=${integrationId}`,
      { headers: { Authorization: `Bearer ${nangoConfig.secretKey}` } }
    );

    // getLog().atInfo().log("Configuration object", JSON.stringify(nangoConnectionObject, null, 2));

    return nangoConnectionObject;
  } else {
    throw new Error("Nango is not enabled, cannot get OAuth credentials");
  }
};
