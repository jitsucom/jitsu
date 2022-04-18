import { JSON_FORMAT } from "./model"
import axios, { AxiosRequestConfig } from "axios"
import * as uuid from "uuid"
import AnalyticsService from "./analytics"
import { BackendUserService } from "./UserServiceBackend"
import { concatenateURLs } from "lib/commons/utils"
import { assert } from "utils/typeCheck"
import { APIError, BackendApiClient, JWTBackendClient } from "./BackendApiClient"
import { HttpServerStorage, ServerStorage } from "./ServerStorage"
import { UserService } from "./UserService"
import { ApplicationConfiguration } from "./ApplicationConfiguration"
import { CurrentSubscription } from "./billing"
import { ISlackApiService, SlackApiService } from "./slack"
import { IOauthService, OauthService } from "./oauth"
import { Project } from "../../generated/conf-openapi"
import { createProjectService, ProjectService } from "./ProjectService"
import { FirebaseUserService } from "./UserServiceFirebase"
import { UserSettingsService, UserSettingsLocalService } from "./UserSettingsService"

export interface IApplicationServices {
  init(): Promise<void>
  userService: UserService
  activeProject: Project
  storageService: ServerStorage
  analyticsService: AnalyticsService
  backendApiClient: BackendApiClient
  features: FeatureSettings
  applicationConfiguration: ApplicationConfiguration
  slackApiSercice: ISlackApiService
  oauthService: IOauthService
  projectService: ProjectService
  showSelfHostedSignUp(): boolean
}

export default class ApplicationServices implements IApplicationServices {
  private readonly _applicationConfiguration: ApplicationConfiguration
  private readonly _analyticsService: AnalyticsService
  private readonly _backendApiClient: BackendApiClient
  private readonly _storageService: ServerStorage
  private readonly _slackApiService: ISlackApiService
  private readonly _oauthService: IOauthService
  private readonly _projectService: ProjectService

  private _userService: UserService
  private _userSettingsService: UserSettingsService
  private _features: FeatureSettings

  public onboardingNotCompleteErrorMessage =
    "Onboarding process hasn't been fully completed. Please, contact the support"
  private _currentSubscription: CurrentSubscription

  constructor() {
    this._applicationConfiguration = new ApplicationConfiguration()
    this._analyticsService = new AnalyticsService(this._applicationConfiguration)
    this._backendApiClient = new JWTBackendClient(
      this._applicationConfiguration.backendApiBase,
      this._applicationConfiguration.backendApiProxyBase,
      () => this._userService.apiAccess(),
      this._analyticsService
    )
    this._storageService = new HttpServerStorage(this._backendApiClient)
    this._slackApiService = new SlackApiService(() => this._userService.apiAccess())
    this._oauthService = new OauthService(this._applicationConfiguration.oauthApiBase, this._backendApiClient)
    this._projectService = createProjectService(this._backendApiClient)
  }

  //load backend configuration and create user service depend on authorization type
  async init() {
    let configuration = await this.loadBackendConfiguration()
    this._features = configuration
    this._analyticsService.configure(this._features)

    if (configuration.authorization == "redis" || !this._applicationConfiguration.firebaseConfig) {
      this._userService = new BackendUserService(
        this._backendApiClient,
        this._storageService,
        configuration.smtp,
        this._features.ssoAuthLink,
        this._applicationConfiguration.backendApiBase
      )
    } else if (configuration.authorization == "firebase") {
      this._userService = new FirebaseUserService(
        this._applicationConfiguration.firebaseConfig,
        this._backendApiClient,
        this._storageService,
        this._analyticsService,
        this._features
      )
    } else {
      throw new Error(`Unknown backend configuration authorization type: ${configuration.authorization}`)
    }
    this._userSettingsService = new UserSettingsLocalService(this._userService)
  }

  get projectService(): ProjectService {
    return this._projectService
  }

  get userService(): UserService {
    return this._userService
  }

  get activeProject(): Project {
    return this._userSettingsService.get("activeProject") as Project
  }

  set activeProject(value: Project) {
    this._userSettingsService.set({ activeProject: value })
  }

  get storageService(): ServerStorage {
    return this._storageService
  }

  get analyticsService(): AnalyticsService {
    return this._analyticsService
  }

  get currentSubscription(): CurrentSubscription {
    return this._currentSubscription
  }

  set currentSubscription(value: CurrentSubscription) {
    this._currentSubscription = value
  }

  get backendApiClient(): BackendApiClient {
    return this._backendApiClient
  }

  get features(): FeatureSettings {
    return this._features
  }

  get slackApiSercice(): ISlackApiService {
    return this._slackApiService
  }

  get oauthService(): IOauthService {
    return this._oauthService
  }

  get storageUserSettingsService(): UserSettingsService {
    return this._userSettingsService
  }

  static get(): ApplicationServices {
    if (window["_en_instance"] === undefined) {
      try {
        window["_en_instance"] = new ApplicationServices()
      } catch (e) {
        console.error("Failed to initialize application services", e)
        document.body.innerHTML = `<pre>Fatal error '${e.message}': \n${e.stack}</pre>`
        if (window.stop) {
          window.stop()
        }
        throw e
      }
    }
    return window["_en_instance"]
  }

  private async loadBackendConfiguration(): Promise<FeatureSettings> {
    let fullUrl = concatenateURLs(this._applicationConfiguration.backendApiBase, "/v1/system/configuration")
    let request: AxiosRequestConfig = {
      method: "GET",
      url: fullUrl,
      transformResponse: JSON_FORMAT,
    }

    let response = await axios(request)

    if (response.status == 200) {
      return mapBackendConfigResponseToAppFeatures(response.data)
    } else {
      throw new APIError(response, request)
    }
  }

  generateToken(): any {
    return {
      token: {
        auth: uuid.v4(),
        s2s_auth: uuid.v4(),
        origins: [],
      },
    }
  }

  get applicationConfiguration(): ApplicationConfiguration {
    return this._applicationConfiguration
  }

  public showSelfHostedSignUp(): boolean {
    return !this._features.users
  }
}

export function mapBackendConfigResponseToAppFeatures(responseData: { [key: string]: unknown }): FeatureSettings {
  let environment: FeatureSettings["environment"] = responseData.selfhosted ? "custom" : "jitsu_cloud"
  if (responseData.docker_hub_id === "heroku") {
    environment = "heroku"
  } else if (responseData.docker_hub_id === "ksense" || responseData.docker_hub_id === "jitsucom") {
    environment = "docker" as const
  }

  let ssoAuthLink = ""
  if (typeof responseData.sso_auth_link === "string") {
    ssoAuthLink = responseData.sso_auth_link
  }

  assert(
    responseData.authorization === "redis" || responseData.authorization === "firebase",
    `Assertion error in mapBackendConfigResponseToAppFeatures: authorization field can be either "redis" or "firebase", but received ${responseData.authorization}`
  )

  assert(
    typeof responseData.smtp === "boolean",
    `Assertion error in mapBackendConfigResponseToAppFeatures: smtp field must be a boolean, but received ${responseData.smtp}`
  )

  return {
    ...responseData,
    createDemoDatabase: !responseData.selfhosted,
    users: !responseData.selfhosted || !!responseData.users,
    enableCustomDomains: !responseData.selfhosted,
    anonymizeUsers: !!responseData.selfhosted,
    appName: responseData.selfhosted ? "selfhosted" : "jitsu_cloud",
    chatSupportType: responseData.selfhosted ? "slack" : "chat",
    billingEnabled: responseData.authorization === "firebase" && !!process.env.BILLING_API_BASE_URL,
    authorization: responseData.authorization,
    ssoAuthLink,
    smtp: responseData.smtp,
    environment: environment,
    onlyAdminCanChangeUserEmail: !!responseData.only_admin_can_change_user_email,
  }
}

export type FeatureSettings = {
  /**
   * Application type (name)
   */
  appName: "jitsu_cloud" | "selfhosted"

  /**
   * Authorization type
   */
  authorization: "redis" | "sso" | "firebase"

  /**
   * Link for SSO authorization
   */
  ssoAuthLink: string

  /**
   * If is there any users in backend DB (no users means we need to run a setup flow)
   */
  users: boolean
  /**
   * If SMTP configured on a server and reset password links should work
   */
  smtp: boolean
  /**
   * If demo database should be created
   */
  createDemoDatabase: boolean

  /**
   * If custom domains should be enabled
   */
  enableCustomDomains: boolean

  /**
   * If statistics we send to Jitsu should be anonymous
   */
  anonymizeUsers: boolean

  /**
   * Jitsu Domain
   */
  jitsuBaseUrl?: string

  /**
   * Slack - once user clicks on icon, it should be directed to slack
   *
   */
  chatSupportType: "slack" | "chat"

  /**
   * If billing is enabled
   */
  billingEnabled: boolean

  /**
   * Environment in which Jitsu runs
   */
  environment: "heroku" | "docker" | "jitsu_cloud" | "custom"

  /**
   * If only admin can change user email. For example in self-hosted instances admin token is required for this method
   */
  onlyAdminCanChangeUserEmail?: boolean
}
