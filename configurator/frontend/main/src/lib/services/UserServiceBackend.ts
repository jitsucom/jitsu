/* eslint-disable */
import { ApiAccess, Project, User } from "./model"
import Marshal from "../commons/marshalling"
import { randomId } from "utils/numbers"
import { cleanAuthorizationLocalStorage, concatenateURLs } from "lib/commons/utils"
import { getBaseUIPath } from "lib/commons/pathHelper"
import { BackendApiClient } from "./BackendApiClient"
import { ServerStorage } from "./ServerStorage"
import { LoginFeatures, TelemetrySettings, UserLoginStatus, UserService } from "./UserService"

export const LS_ACCESS_KEY = "en_access"
export const LS_REFRESH_KEY = "en_refresh"

export class BackendUserService implements UserService {
  private user?: User
  private apiAccess: ApiAccess
  private backendApi: BackendApiClient
  private readonly storageService: ServerStorage
  private readonly smtpConfigured: boolean
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

  login(email: string, password: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this.backendApi
        .post("/users/signin", { email: email, password: password }, { noauth: true })
        .then(response => {
          this.apiAccess = new ApiAccess(response["access_token"], response["refresh_token"], this.setTokens)
          this.setTokens(response["access_token"], response["refresh_token"])

          resolve(response)
        })
        .catch(error => reject(error))
    })
  }

  async createUser(email: string, password: string): Promise<void> {
    const signUpPayload = {
      email: email,
      password: password,
    }

    const response = await this.backendApi.post("/users/signup", signUpPayload, { noauth: true })

    this.apiAccess = new ApiAccess(response["access_token"], response["refresh_token"], this.setTokens)
    this.setTokens(response["access_token"], response["refresh_token"])

    const user = new User(
      response["user_id"],
      () => this.apiAccess,
      {
        name: null,
        email: email,
        companyName: null,
      },
      {
        _name: name,
        _project: new Project(randomId(), null),
      }
    )

    user.created = new Date()

    this.user = user

    await this.update(user)
  }

  async setupUser({ email, password, name, company = "", emailOptout = false }): Promise<void> {
    if (!name || name === "") {
      throw new Error("Name is not set")
    }
    const signUpPayload = {
      email,
      password,
      name,
      company,
      emailOptout,
      usageOptout: false,
    }
    const response = await this.backendApi.post("/users/onboarded/signup", signUpPayload, { noauth: true })

    this.apiAccess = new ApiAccess(response["access_token"], response["refresh_token"], this.setTokens)
    this.setTokens(response["access_token"], response["refresh_token"])

    const user = new User(
      response["user_id"],
      () => this.apiAccess,
      {
        name: name,
        email: email,
        companyName: company,
      },
      {
        _name: name,
        _project: new Project(randomId(), company),
      }
    )

    user.created = new Date()
    user.emailOptout = emailOptout
    user.onboarded = true

    this.user = user

    await this.update(user)
  }

  public async waitForUser(): Promise<UserLoginStatus> {
    if (this.user) {
      return { user: this.user, loggedIn: true }
    }

    try {
      const user = await this.restoreUser()
      if (user) {
        return { user: user, loggedIn: true }
      } else {
        return { user: null, loggedIn: false }
      }
    } catch (error) {
      this.clearTokens()
      throw new Error(error)
    }
  }

  private async restoreUser(): Promise<User> {
    const { accessToken, refreshToken } = this.getTokens()

    //not authorized
    if (!accessToken) {
      return null
    }

    //initialize authorization for getting users info (auth required)
    this.apiAccess = new ApiAccess(accessToken, refreshToken, this.setTokens)
    this.user = new User(null, () => this.apiAccess, null, null)

    let userInfo = await this.storageService.getUserInfo()

    if (Object.keys(userInfo).length !== 0) {
      this.user = new User(userInfo["_uid"], () => this.apiAccess, userInfo["_suggestedInfo"], userInfo)
      return this.user
    } else {
      throw new Error("User info wasn't found")
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

    this.backendApi.post("/users/signout", {}).then(cleaningCallback).catch(cleaningCallback)
  }

  getUser(): User {
    if (!this.user) {
      throw new Error("User is null")
    }
    return this.user
  }

  async getUserEmailStatus(): Promise<{ needsConfirmation: false }> {
    return { needsConfirmation: false }
  }

  update(user: User): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (user.projects == null) {
        reject(new Error(`Can't update user without projects:` + JSON.stringify(user)))
      }
      if (user.projects.length != 1) {
        reject(
          new Error(`Can't update user projects ( ` + user.projects.length + `), should be 1` + JSON.stringify(user))
        )
      }
      const userData: any = Marshal.toPureJson(user)
      userData["_project"] = Marshal.toPureJson(user.projects[0])
      delete userData["_projects"]
      return this.storageService.saveUserInfo(userData).then(resolve)
    })
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

    let appPath = ""
    const baseUIPath = getBaseUIPath()
    if (baseUIPath !== undefined) {
      appPath = baseUIPath
    }

    return this.backendApi.post(
      "/users/password/reset",
      {
        email: email,
        callback: concatenateURLs(
          `${window.location.protocol}//${window.location.host}`,
          concatenateURLs(appPath, `/reset_password/{{token}}`)
        ),
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
      .then(res => {
        localStorage.removeItem(LS_ACCESS_KEY)
        localStorage.removeItem(LS_REFRESH_KEY)
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
    throw new Error("loginWithLink is not supporteb by self-hosted user service")
  }

  async getIdToken(): Promise<string> {
    throw new Error("getIdToken is not supporteb by self-hosted user service")
  }
}
