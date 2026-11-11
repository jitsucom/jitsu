// Keep this shared endpoint on a supported version: https://developers.google.com/google-ads/api/docs/sunset-dates
export const googleAdsBaseUrl = "https://googleads.googleapis.com/v26/";
export function googleAdsHeaders(accessToken: string, developerToken: string, loginCustomerId?: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "developer-token": developerToken,
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
  };
}
