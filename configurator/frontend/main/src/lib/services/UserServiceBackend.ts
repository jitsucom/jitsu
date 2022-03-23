import { ApiAccess, userFromDTO, userToDTO } from "./model"
import { cleanAuthorizationLocalStorage, concatenateURLs } from "lib/commons/utils"
import { getFullUiPath } from "lib/commons/pathHelper"
import { BackendApiClient } from "./BackendApiClient"
import { ServerStorage } from "./ServerStorage"
import { LoginFeatures, TelemetrySettings, UserEmailStatus, UserService } from "./UserService"
import { SignupRequest, TokensResponse, User } from "../../generated/conf-openapi"

export const LS_ACCESS_KEY = "en_access"
export const LS_REFRESH_KEY = "en_refresh"

export class BackendUserService implements UserService {
  private user?: User
  private backendApi: BackendApiClient
  private readonly storageService: ServerStorage
  private readonly smtpConfigured: boolean
  private _apiAccess: ApiAccess
  private readonly ssoAuthLink: string

  constructor(
    backendApi: BackendApiClient,
    storageService: ServerStorage,
    smtpConfigured: boolean,
    ssoAuthLink: string,
    backendApiBase: string
  ) {
    this.backendApi = backendApi
    this.storageService = storageService
    this.smtpConfigured = smtpConfigured
    if (ssoAuthLink !== "") {
      this.ssoAuthLink = `${ssoAuthLink}&redirect_uri=${encodeURI(backendApiBase)}/v1/sso-auth-callback`
    }
  }

  initiateGithubLogin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      reject(new Error("GitHub authorization isn't supported in BackendUserService"))
    })
  }

  initiateGoogleLogin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      reject(new Error("Google authorization isn't supported in BackendUserService"))
    })
  }

  async sendConfirmationEmail(): Promise<never> {
    throw new Error("Email verification currently not supported in self-hosted version")
  }

  async login(email: string, password: string): Promise<void> {
    let response = await this.backendApi.post("/users/signin", { email, password }, { noauth: true })
    this._apiAccess = new ApiAccess(response["access_token"], response["refresh_token"], this.setTokens)
    this.setTokens(response["access_token"], response["refresh_token"])
  }

  async createUser(signup: SignupRequest): Promise<void> {
    const response = await this.backendApi.post("/users/signup", signup, { noauth: true })
    this.user = {
      suggestedCompanyName: signup.company,
      created: new Date().toISOString(),
      id: response["user_id"],
      emailOptout: signup.emailOptout,
      forcePasswordChange: false,
      name: signup.name,
      email: signup.email,
    }

    this._apiAccess = new ApiAccess(response["access_token"], response["refresh_token"], this.setTokens)
    await this.storageService.saveUserInfo(userToDTO(this.user))
  }

  public async waitForUser(): Promise<void> {
    if (this.user) {
      return
    }

    try {
      const { accessToken, refreshToken } = this.getTokens()
      //not authorized
      if (!accessToken) {
        return
      }

      this._apiAccess = new ApiAccess(accessToken, refreshToken, this.setTokens)
      let userDTO = await this.storageService.getUserInfo()
      this.user = userFromDTO(userDTO)
    } catch (error) {
      this.clearTokens()
      throw new Error(error)
    }
  }

  private getTokens(): { accessToken?: string; refreshToken?: string } {
    return {
      accessToken: localStorage.getItem(LS_ACCESS_KEY),
      refreshToken: localStorage.getItem(LS_REFRESH_KEY),
    }
  }

  private setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(LS_ACCESS_KEY, accessToken)
    localStorage.setItem(LS_REFRESH_KEY, refreshToken)
  }

  private clearTokens(): void {
    localStorage.removeItem(LS_ACCESS_KEY)
    localStorage.removeItem(LS_REFRESH_KEY)
  }

  removeAuth(callback: () => void) {
    const cleaningCallback = () => {
      cleanAuthorizationLocalStorage()
      callback()
    }

    this.backendApi.post("/users/signout", {}).finally(cleaningCallback)
  }

  getUser(): User {
    if (!this.user) {
      throw new Error("User is null. Should you called services.userService.hasUser()?")
    }
    return this.user
  }

  getUserEmailStatus(): UserEmailStatus {
    return { needsConfirmation: false }
  }

  sendPasswordReset(email?: string): Promise<void> {
    if (!this.smtpConfigured) {
      throw new Error(
        "SMTP isn't configured on the server. However you could change password by executing 'change_password.sh' from git repository!"
      )
    }

    if (!email) {
      email = this.getUser().email
    }

    return this.backendApi.post(
      "/users/password/reset",
      {
        email: email,
        callback: concatenateURLs(getFullUiPath(), `/reset_password/{{token}}`),
      },
      { noauth: true }
    )
  }

  hasUser(): boolean {
    return !!this.user
  }

  changePassword(newPassword: string, resetId?: string): Promise<void> {
    return this.backendApi
      .post("/users/password/change", { new_password: newPassword, reset_id: resetId }, { noauth: !!resetId })
      .then((res: TokensResponse) => {
        if (!!this._apiAccess) {
          this._apiAccess.updateTokens(res.access_token, res.refresh_token)
        } else {
          this.clearTokens()
        }
      })
  }

  //changeEmail is supported via CLUSTER_ADMIN_TOKEN only
  async changeEmail(newEmail: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      reject(new Error("changeEmail isn't supported in BackendUserService"))
    })
  }

  async changeTelemetrySettings(newSettings: TelemetrySettings): Promise<void> {
    await this.backendApi.post("/configurations/telemetry?id=global_configuration", {
      disabled: { usage: !newSettings.isTelemetryEnabled },
    })
  }

  //isn't supported (without google authorization)
  async becomeUser(email: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      reject(new Error("becomeUser isn't supported in BackendUserService"))
    })
  }

  getLoginFeatures(): LoginFeatures {
    return { oauth: false, password: true, signupEnabled: false }
  }

  getSSOAuthLink(): string {
    return this.ssoAuthLink ?? ""
  }

  sendLoginLink(email: string): Promise<void> {
    throw new Error("sendLoginLink is not supporteb by self-hosted user service")
  }

  supportsLoginViaLink(): boolean {
    return false
  }

  isEmailLoginLink(href: string): boolean {
    throw new Error("isEmailLoginLink is not supporteb by self-hosted user service")
  }

  loginWithLink(email: string, href: string): Promise<void> {
    throw new Error("loginWithLink is not supported by self-hosted user service")
  }

  async getIdToken(): Promise<string> {
    throw new Error("getIdToken is not supported by self-hosted user service")
  }

  apiAccess(): ApiAccess {
    return this._apiAccess
  }

  refreshAuth(): Promise<void> {
    return Promise.resolve()
  }
}
