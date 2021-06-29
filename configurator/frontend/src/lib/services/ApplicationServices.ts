/* eslint-disable */
import { ApiAccess, Project, User } from './model';
import axios, { AxiosRequestConfig, AxiosResponse, AxiosTransformer, Method } from 'axios';
import * as uuid from 'uuid';
import AnalyticsService from './analytics';
import { firebaseInit, FirebaseUserService } from './firebase';
import Marshal from '../commons/marshalling';
import { BackendUserService } from './backend';
import { randomId } from '@util/numbers';
import { cleanAuthorizationLocalStorage, concatenateURLs, reloadPage } from '@./lib/commons/utils';
import { getBackendApiBase } from '@./lib/commons/pathHelper';

type AppEnvironmentType = 'development' | 'production';

export class ApplicationConfiguration {
  private readonly _rawConfig: RawConfigObject;
  private readonly _firebaseConfig: any;
  private readonly _backendApiBase: string;
  private readonly _backendApiProxyBase: string;
  /**
   * One of the following: development, production
   */
  private readonly _appEnvironment: AppEnvironmentType;
  private readonly _buildId: string;

  constructor() {
    this._rawConfig = getRawApplicationConfig();
    this._firebaseConfig = this._rawConfig.firebase;
    const backendApi = getBackendApiBase(this._rawConfig.env);
    this._backendApiBase = concatenateURLs(backendApi, '/api/v1');
    this._backendApiProxyBase = concatenateURLs(backendApi, '/proxy/api/v1');
    this._appEnvironment = (this._rawConfig.env.NODE_ENV || 'production').toLowerCase() as AppEnvironmentType;
    this._buildId = [
      `b=${this._rawConfig.env.BUILD_ID || 'dev'}`,
      `sc=${this._rawConfig.env.GIT_BRANCH || 'unknown'}/${this._rawConfig.env.GIT_COMMIT_REF || 'unknown'}`,
      `t=${this._rawConfig.env.BUILD_TIMESTAMP || 'unknown'}`
    ].join(";");

    console.log(
      `App initialized. Backend: ${this._backendApiBase}. Env: ${this._appEnvironment}. Firebase configured: ${!!this
        ._firebaseConfig}. Build info: ${this._buildId}`
    );
  }

  get buildId(): string {
    return this._buildId;
  }

  get firebaseConfig(): any {
    return this._firebaseConfig;
  }

  get appEnvironment() {
    return this._appEnvironment;
  }

    get backendApiBase(): string {
        return this._backendApiBase;
    }

  get backendApiProxyBase(): string {
    return this._backendApiProxyBase;
  }

  get rawConfig(): RawConfigObject {
    return this._rawConfig;
  }
}

export type RawConfigObject = {
  env: Record<string, string>;
  firebase?: Record<string, string>;
  keys: {
    logrocket?: string;
    intercom?: string;
    eventnative?: string;
  };
};

export type FeatureSettings = {
  /**
   * Application type (name)
   */
  appName: 'jitsu_cloud' | 'selfhosted';

  /**
   * Authorization type
   */
  authorization: 'redis' | 'firebase';
  /**
   * If is there any users in backend DB (no users means we need to run a setup flow)
   */
  users: boolean;
  /**
   * If SMTP configured on a server and reset password links should work
   */
  smtp: boolean;
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
  chatSupportType: 'slack' | 'chat'

  /**
   * If billing is enabled
   */
  billingEnabled: boolean

  /**
   * Environment in which Jitsu runs
   */
  environment: 'heroku' | 'docker' | 'jitsu_cloud' | 'custom'
};

function parseJson(envVar, defaultValue) {
  if (envVar) {
    try {
      return JSON.parse(envVar);
    } catch (e) {
      throw new Error(
        `env variable suppose to contain JSON, but the content (${envVar}) is not parsable: ${e.message}`
      );
    }
  }
  return defaultValue;
}

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



function getRawApplicationConfig(): RawConfigObject {
  return {
    env: process.env || {},
    firebase: parseJson(process.env.FIREBASE_CONFIG, null),
    keys: parseJson(process.env.ANALYTICS_KEYS, {}),
  };
}

export default class ApplicationServices {
  private readonly _applicationConfiguration: ApplicationConfiguration;
  private readonly _analyticsService: AnalyticsService;
  private readonly _backendApiClient: BackendApiClient;
  private readonly _storageService: ServerStorage;

  private _userService: UserService;
  private _features: FeatureSettings;

  public onboardingNotCompleteErrorMessage =
    "Onboarding process hasn't been fully completed. Please, contact the support";

  constructor() {
    this._applicationConfiguration = new ApplicationConfiguration();
    this._analyticsService = new AnalyticsService(this._applicationConfiguration);
    this._backendApiClient = new JWTBackendClient(
      this._applicationConfiguration.backendApiBase,
      this._applicationConfiguration.backendApiProxyBase,
      () => this._userService.getUser().apiAccess,
      this._analyticsService
    );
    this._storageService = new HttpServerStorage(this._backendApiClient);
  }

  //load backend configuration and create user service depend on authorization type
  async init() {
    let configuration = await this.loadBackendConfiguration();
    this._features = configuration;
    this._analyticsService.configure(this._features);

    if (configuration.authorization == 'redis' || !this._applicationConfiguration.firebaseConfig) {
      this._userService = new BackendUserService(this._backendApiClient, this._storageService, configuration.smtp);
    } else if (configuration.authorization == 'firebase') {
      firebaseInit(this._applicationConfiguration.firebaseConfig);
      this._userService = new FirebaseUserService(this._backendApiClient, this._storageService);
    } else {
      throw new Error(`Unknown backend configuration authorization type: ${configuration.authorization}`);
    }
  }

  get userService(): UserService {
    return this._userService;
  }



  get activeProject(): Project {
    return this.userService.getUser().projects[0];
  }

  get storageService(): ServerStorage {
    return this._storageService;
  }

  get analyticsService(): AnalyticsService {
    return this._analyticsService;
  }

  static get(): ApplicationServices {
    if (window['_en_instance'] === undefined) {
      try {
        window['_en_instance'] = new ApplicationServices();
      } catch (e) {
        console.error('Failed to initialize application services', e);
        document.body.innerHTML = `<pre>Fatal error '${e.message}': \n${e.stack}</pre>`;
        if (window.stop) {
          window.stop();
        }
        throw e;
      }
    }
    return window['_en_instance'];
  }

  get backendApiClient(): BackendApiClient {
    return this._backendApiClient;
  }

  get features(): FeatureSettings {
    return this._features;
  }
  private async loadBackendConfiguration(): Promise<FeatureSettings> {
    let fullUrl = concatenateURLs(this._applicationConfiguration.backendApiBase, '/system/configuration');
    let request: AxiosRequestConfig = {
      method: 'GET',
      url: fullUrl,
      transformResponse: JSON_FORMAT
    };

    let response = await axios(request);

    let environment = response.data.selfhosted ? 'custom' : 'jitsu_cloud';
    if (response.data.docker_hub_id === 'heroku') {
      environment = 'heroku';
    } else if (response.data.docker_hub_id === 'ksense' || response.data.docker_hub_id === 'jitsucom') {
      environment = 'docker';
    }

    if (response.status == 200) {
      return {
        ...(response.data),
        createDemoDatabase: !response.data.selfhosted,
        users: !response.data.selfhosted || response.data.users,
        enableCustomDomains: !response.data.selfhosted,
        anonymizeUsers: !!response.data.selfhosted,
        appName: response.data.selfhosted ? 'selfhosted' : 'jitsu_cloud',
        chatSupportType: response.data.selfhosted ? 'slack' : 'chat',
        billingEnabled: !response.data.selfhosted,
        environment: environment
      };
    } else {
      throw new APIError(response, request);
    }
  }

  public async initializeDefaultDestination(): Promise<{ credentials: PgDatabaseCredentials, destinations: DestinationData[] }> {
    let credentials: PgDatabaseCredentials = await this._backendApiClient.post('/database', {
      projectId: this.activeProject.id
    });
    const destinationData: DestinationData = {
      _type: 'postgres',
      _comment: "We set up a test postgres database for you. It's hosted by us and has a 10,000 rows limitation. It's ok" +
        " to try with service with it. However, don't use it in production setup. To reveal credentials, click on the 'Edit' button",
      _id: "demo_postgres",
      _uid: randomId(),
      _mappings: null,
      _onlyKeys: [],
      _connectionTestOk: true,
      _sources: [],
      _formData: {
        pguser: credentials['User'],
        pgpassword: credentials['Password'],
        pghost: credentials['Host'],
        pgport: credentials['Port'],
        pgdatabase: credentials['Database'],
        mode: 'stream'
      }
    } ;
    const destinations = [destinationData];
    await this._storageService.save('destinations', { destinations }, this.activeProject.id);
    return { credentials, destinations };
  }

  generateToken(): any {
    return {
      token: {
        auth: uuid.v4(),
        s2s_auth: uuid.v4(),
        origins: []
      }
    };
  }

  get applicationConfiguration(): ApplicationConfiguration {
    return this._applicationConfiguration;
  }

  public showSelfHostedSignUp(): boolean {
    return !this._features.users;
  }
}

export type UserLoginStatus = {
  user?: User;
  loggedIn: boolean;
};

export interface LoginFeatures {
  oauth: boolean;
  password: boolean;
  signupEnabled: boolean;
}

type UserEmailStatus = 
  | { needsConfirmation: true; isConfirmed: boolean }
  | { needsConfirmation: false }

export type TelemetrySettings = {
  isTelemetryEnabled: boolean;
}

export interface SetupUserProps {
  email: string
  password: string
  name?: string
  company?: string
  emailOptout?: boolean
  usageOptout?: boolean
}

export interface UserService {
  /**
   * Logs in user. On success user must reload
   * @param email email
   * @param password password
   * @returns a promise
   */
  login(email: string, password: string): Promise<void>;

  getLoginFeatures(): LoginFeatures;

  /**
   * Initiates google login. Returns promise on email of the user . On success user must reload
   * page.
   */
  initiateGoogleLogin(redirect?: string): Promise<string>;

  /**
   * Initiates google login
   */
  initiateGithubLogin(redirect?: string);

  /**
   * Get (wait for) logged in user (or null if user is not logged in).
   */
  waitForUser(): Promise<UserLoginStatus>;

  /**
   * Get current logged in user. Throws exception if user is not available
   */
  getUser(): User;

  /**
   * Checks if current user's email needs confirmation and if it is confirmed.
   * @returns an object with the corresponding fields
   */
  getUserEmailStatus(): Promise<UserEmailStatus>;

  /**
   * Checks if any valid user is logged in.
   */
  hasUser(): boolean;

  /**
   * Sends user a reset password link via email
   * @param email - email to send the link to
   */
  sendPasswordReset(email?: string);

  sendConfirmationEmail(): Promise<void>;

  /**
   * Changes account password if signed up with email and password.
   * @param value new password
   * @param resetId token from the password reset link; Needed if user is not logged in.
   */
  changePassword(value: string, resetId?: string): Promise<void>;

  /**
   * Changes account email.
   * @param value - new email
   */
  changeEmail(value: string): Promise<void>;

  /**
   * Changes user's telemetry preferences.
   * @param newSettings - telemetry settings
   */
  changeTelemetrySettings(newSettings: TelemetrySettings): Promise<void>;

  update(user: User);

  removeAuth(callback: () => void);

  createUser(email: string, password: string): Promise<void>;

  setupUser(userProps: SetupUserProps): Promise<void>;

  becomeUser(email: string): Promise<void>;

  supportsLoginViaLink(): boolean;

  sendLoginLink(email: string): Promise<void>

  isEmailLoginLink(href: string): boolean;

  loginWithLink(email: string, href: string): Promise<void>;
}

/**
 * Sets debug info that is available as __enUIDebug in dev console. So far
 * sets the field in any case, later it will be possible to do in only in dev mode
 * @param field
 * @param obj
 */
export function setDebugInfo(field: string, obj: any, purify = true) {
  if (window) {
    if (!window['__enUIDebug']) {
      window['__enUIDebug'] = {};
    }
    window['__enUIDebug'][field] = typeof obj === 'object' && purify ? Object.assign({}, obj) : obj;
  }
}

/**
 * Additional options for API request
 */
export type ApiRequestOptions = {
  /**
   * If request should be sent to /proxy endpoint
   */
  proxy?: boolean
  /**
   * Get parameters (to avoid adding them to URL for better readability)
   */
  urlParams?: { [propName: string]: any }
  /**
   * If set to true, Auth header should not be added
   */
  noauth?: boolean
}

/**
 * Backend API client. Authorization is handled by implementation
 */
export interface BackendApiClient {
  /**
   * For end-points that returns JSON. In that case response will
   * be deserialized
   * @param url url
   * @param payload payload
   * @param opts additional options
   */
  post(url, payload: any, opts?: ApiRequestOptions): Promise<any>;

  /**
   * Same as post, but returns raw body
   */
  postRaw(url, data: any, opts?: ApiRequestOptions): Promise<string>;

  getRaw(url, opts?: ApiRequestOptions): Promise<string>;

  get(url: string, opts?: ApiRequestOptions): Promise<any>;
}

class APIError extends Error {
  private _httpStatus: number;
  private _response: any;

  constructor(response: AxiosResponse, request: AxiosRequestConfig) {
    super(getErrorMessage(response, request));
    this._httpStatus = response.status;
    this._response = response.data;
  }
}

function getErrorMessage(response: AxiosResponse, request: AxiosRequestConfig): string {
  let errorResponse = parseErrorResponseBody(response);
  if (errorResponse && errorResponse.message) {
    return `${errorResponse.message} (#${response.status})`;
  } else {
    return `Error ${response.status} at ${request.url}`;
  }
}

function parseErrorResponseBody(response: AxiosResponse) {
  let strResponse = response.data.toString();
  if (response.data === null || response.data === undefined) {
    return null;
  }
  if (typeof response.data === 'object') {
    return response.data;
  }
  try {
    return response.data ? JSON.parse(response.data.toString()) : null;
  } catch (e) {
    return null;
  }
}

export interface Transformer<T> {
  (data: any, headers?: any): T;
}

const JSON_FORMAT: Transformer<any> = undefined;
const AS_IS_FORMAT: Transformer<string> = (response) => (response ? response.toString() : null);

export class JWTBackendClient implements BackendApiClient {
  private readonly baseUrl: string;
  private readonly proxyUrl: string;
  private readonly apiAccessAccessor: () => ApiAccess;
  private readonly analyticsService: AnalyticsService;

  constructor(baseUrl: string, proxyUrl:string, apiAccessAccessor: () => ApiAccess, analyticsService: AnalyticsService) {
    this.baseUrl = baseUrl;
    this.proxyUrl = proxyUrl;
    this.apiAccessAccessor = apiAccessAccessor;
    this.analyticsService = analyticsService;

    //Refresh token axios interceptor
    axios.interceptors.response.use(
      (response) => {
        return response;
      },
      function (error) {
        const originalRequest = error.config;

        //try to refresh only if 401 error + authorization supports refresh tokens
        if (
          error.response &&
          error.response.status === 401 &&
          apiAccessAccessor().supportRefreshToken() &&
          !originalRequest._retry &&
          !originalRequest.url.includes('/users/token/refresh')
        ) {
          originalRequest._retry = true;
          return axios
            .post(concatenateURLs(baseUrl, '/users/token/refresh'), {
              refresh_token: apiAccessAccessor().refreshToken
            })
            .then((res) => {
              if (res.status === 200) {
                apiAccessAccessor().updateTokens(res.data['access_token'], res.data['refresh_token']);
                originalRequest.headers = {
                  'X-Client-Auth': apiAccessAccessor().accessToken
                };
                return axios(originalRequest);
              }
            });
        }

        return Promise.reject(error);
      }
    );
  }

  private exec(
    method: Method,
    transform: AxiosTransformer,
    url: string,
    payload: any,
    opts: ApiRequestOptions
  ): Promise<any> {
    let fullUrl = concatenateURLs(this.baseUrl, url);
    if (opts.proxy){
      fullUrl = concatenateURLs(this.proxyUrl, url);
    }
    if (opts.urlParams) {
      fullUrl += "?" + Object.entries(opts.urlParams)
        .filter(([,val]) => val !== undefined)
        .map(([key, val]) => `${key}=${encodeURIComponent(val + "")}`).join("&")
    }

    let request: AxiosRequestConfig = {
      method: method,
      url: fullUrl,
      transformResponse: transform
    };

    if (!opts.noauth) {
      request.headers = {
        'X-Client-Auth': this.apiAccessAccessor().accessToken
      };
    }

    if (payload !== undefined) {
      if (method.toLowerCase() === 'get') {
        throw new Error(`System UI Error: GET ${fullUrl} can't have a body`);
      }
      request.data = payload;
    }

    return new Promise<any>((resolve, reject) => {
      axios(request)
        .then((response: AxiosResponse<any>) => {
          if (response.status == 200 || response.status == 201) {
            resolve(response.data);
          } else if (response.status == 204) {
            resolve({});
          } else {
            let error = new APIError(response, request);
            this.handleApiError(request, response);
            reject(error);
          }
        })
        .catch((error) => {
          if (error.response) {
            this.handleApiError(request, error.response);
            reject(new APIError(error.response, request));
          } else {
            let baseMessage = 'Request at ' + fullUrl + ' failed';
            if (error.message) {
              baseMessage += ' with ' + error.message;
            }
            this.analyticsService.onFailedAPI({
              method: request.method,
              url: request.url,
              requestPayload: request.data,
              responseStatus: -1,
              errorMessage: baseMessage
            });
            reject(error);
            reject(new Error(baseMessage));
          }
        });
    });
  }

  private handleApiError(request: AxiosRequestConfig, response: AxiosResponse<any>) {
    this.analyticsService.onFailedAPI({
      method: request.method,
      url: request.url,
      requestPayload: request.data,
      responseStatus: response.status,
      responseObject: response.data
    });

    //we should remove authorization and reload page
    if (response.status == 401){
      cleanAuthorizationLocalStorage()
      reloadPage()
    }
  }

  get(url: string, opts?: ApiRequestOptions): Promise<any> {
    return this.exec('get', JSON_FORMAT, url, undefined, opts ?? {});
  }

  post(url: string, data: any, opts?: ApiRequestOptions): Promise<any> {
    return this.exec('post', JSON_FORMAT, url, data, opts ?? {});
  }

  postRaw(url, data: any, opts?: ApiRequestOptions): Promise<string> {
    return this.exec('post', AS_IS_FORMAT, url, data ?? {}, opts ?? {});
  }

  getRaw(url, opts?: ApiRequestOptions): Promise<string> {
    return this.exec('get', AS_IS_FORMAT, url, undefined, opts ?? {});
  }
}


/**
 * A generic object storage
 */
export interface ServerStorage {
  /**
   * Returns an object by key. If key is not set, user id will be used as key
   */
  get(collectionName: string, key: string): Promise<any>;

  /**
   * Returns user info object (user id is got from authorization token)
   */
  getUserInfo(): Promise<User>;

  /**
   * Saves an object by key. If key is not set, user id will be used as key
   */
  // ToDo: key is required parameter according to save-method signature, ask Vladimir about that
  save(collectionName: string, data: any, key: string): Promise<void>;

  /**
   * Saves users information required for system (on-boarding status, user projects, etc.)
   * (user id is got from authorization token)
   * @param data User JSON representation
   */
  saveUserInfo(data: any): Promise<void>;
}

class HttpServerStorage implements ServerStorage {
  private static readonly USERS_INFO_PATH = '/users/info';
  private backendApi: BackendApiClient;

  constructor(backendApi: BackendApiClient) {
    this.backendApi = backendApi;
  }

  getUserInfo(): Promise<User> {
    return this.backendApi.get(`${HttpServerStorage.USERS_INFO_PATH}`);
  }

  saveUserInfo(data: any): Promise<void> {
    return this.backendApi.post(`${HttpServerStorage.USERS_INFO_PATH}`, Marshal.toPureJson(data));
  }

  get(collectionName: string, key: string): Promise<any> {
    return this.backendApi.get(`/configurations/${collectionName}?id=${key}`);
  }

  save(collectionName: string, data: any, key: string): Promise<void> {
    return this.backendApi.post(`/configurations/${collectionName}?id=${key}`, Marshal.toPureJson(data));
  }
}
