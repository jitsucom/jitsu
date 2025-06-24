export interface OidcSessionData {
  userId: string;
  email?: string | null;
  name?: string | null;
  loginProvider: string;
  externalId: string;
  providerId?: string;
  timestamp: number;
  exp: number;
  tokens?: {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt: number;
  };
}

export interface OidcTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
}

export interface OidcTokenResponse {
  access_token: string;
  token_type: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface OidcUserInfo {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  groups?: string[];
  [key: string]: any;
}
