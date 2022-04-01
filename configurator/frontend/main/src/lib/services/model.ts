import { User } from "../../generated/conf-openapi"

/**
 * Structure of /database API response
 */
export type PgDatabaseCredentials = {
  User: string
  Password: string
  Host: string
  Port: string
  Database: string
}

export interface Transformer<T> {
  (data: any, headers?: any): T
}

export const JSON_FORMAT: Transformer<any> = undefined
export const AS_IS_FORMAT: Transformer<string> = response => (response ? response.toString() : null)

/**
 * User information that was retried from auth method. Might contain
 * some information that will be usefull for autofill during on-boarding process
 */
export type SuggestedUserInfo = {
  //mandatory: user email (lower-case)
  email: string
  //user name (Firstname Lastname)
  name?: string
  //Company name
  companyName?: string
}

export enum Permission {
  BECOME_OTHER_USER,
}

/**
 * User internal representation. This class is here for backward compatibility
 */
export type UserDTO = {
  $type: "User"
  _created: string
  _uid: string
  _name: string
  _email: string
  _emailOptout: boolean
  _forcePasswordChange: boolean
  _lastUpdated: string
  _onboarded: boolean
  _suggestedInfo: {
    companyName?: string
    email?: string
    name?: string
  }
  _project?: {
    $type: "Project"
    _id: string
    _name: string | null
    _requireSetup?: boolean
  }
}

export function userToDTO(user: User): UserDTO {
  return {
    _uid: user.id,
    _name: user.name,
    _emailOptout: user.emailOptout || false,
    _forcePasswordChange: user.forcePasswordChange || false,
    _lastUpdated: new Date().toISOString(),
    _suggestedInfo: {
      companyName: user.suggestedCompanyName || undefined,
      email: user.email || undefined,
      name: user.name || undefined,
    },
    $type: "User",
    _created: user.created || new Date().toISOString(),
    _email: user.email,
    _onboarded: true,
  }
}

export function userFromDTO(dto: UserDTO): User {
  return {
    created: dto._created || new Date().toISOString(),
    email: dto._email || dto._suggestedInfo?.email,
    emailOptout: dto._emailOptout || false,
    forcePasswordChange: dto._forcePasswordChange || false,
    name: dto._name || dto._suggestedInfo?.name,
    id: dto._uid,
    suggestedCompanyName: dto._suggestedInfo?.companyName,
  }
}

export type Domain = {
  name: string
  status: "pending" | "verified"
  comment?: string
}

export class ApiAccess {
  private _accessToken: string
  private _refreshToken: string
  private _localStorageTokensUpdateCallback: (accessToken: string, refreshToken: string) => void

  constructor(
    accessToken: string,
    refreshToken: string,
    localStorageTokensUpdateCallback: (accessToken: string, refreshToken: string) => void
  ) {
    this._accessToken = accessToken
    this._refreshToken = refreshToken
    this._localStorageTokensUpdateCallback = localStorageTokensUpdateCallback
  }

  get accessToken(): string {
    return this._accessToken
  }

  get refreshToken(): string {
    return this._refreshToken
  }

  supportRefreshToken(): boolean {
    return this._refreshToken != null
  }

  updateTokens(accessToken: string, refreshToken: string) {
    this._accessToken = accessToken
    this._refreshToken = refreshToken
    this._localStorageTokensUpdateCallback(accessToken, refreshToken)
  }
}
