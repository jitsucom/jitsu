export const googleAdsBaseUrl = "https://googleads.googleapis.com/v22/";
export function googleAdsHeaders(accessToken: string, developerToken: string, loginCustomerId?: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "developer-token": developerToken,
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
  };
}
