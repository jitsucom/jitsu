export const dataManagerBaseUrl = "https://datamanager.googleapis.com/v1/";
/** Manager-account routing applies to account resource APIs, not ingestion/status calls. */
export function dataManagerHeaders(accessToken: string, loginCustomerId?: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...(loginCustomerId ? { "login-account": `accountTypes/GOOGLE_ADS/accounts/${loginCustomerId}` } : {}),
  };
}
