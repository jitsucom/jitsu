/* eslint-disable */
import { IProject, JSON_FORMAT, PgDatabaseCredentials } from './model';
import axios, { AxiosRequestConfig } from 'axios';
import * as uuid from 'uuid';
import AnalyticsService from './analytics';
import { firebaseInit, FirebaseUserService } from './UserServiceFirebase';
import { BackendUserService } from './UserServiceBackend';
import { randomId } from 'utils/numbers';
import { concatenateURLs } from 'lib/commons/utils';
import { assert } from 'utils/typeCheck';
import {
  APIError,
  BackendApiClient,
  JWTBackendClient
} from './BackendApiClient';
import { HttpServerStorage, ServerStorage } from './ServerStorage';
import { UserService } from './UserService';
import { ApplicationConfiguration } from './ApplicationConfiguration';

export interface IApplicationServices {
  init(): Promise<void>;
  userService: UserService;
  activeProject: IProject;
  storageService: ServerStorage;
  analyticsService: AnalyticsService;
  backendApiClient: BackendApiClient;
  features: FeatureSettings;
  applicationConfiguration: ApplicationConfiguration;
  showSelfHostedSignUp(): boolean;
}
export default class ApplicationServices implements IApplicationServices {
  private readonly _applicationConfiguration: ApplicationConfiguration;
  private readonly _analyticsService: AnalyticsService;
  private readonly _backendApiClient: BackendApiClient;
  private readonly _billingApiClient: BackendApiClient;
  private readonly _storageService: ServerStorage;

  private _userService: UserService;
  private _features: FeatureSettings;

  public onboardingNotCompleteErrorMessage =
    "Onboarding process hasn't been fully completed. Please, contact the support";

  constructor() {
    this._applicationConfiguration = new ApplicationConfiguration();
    this._analyticsService = new AnalyticsService(
      this._applicationConfiguration
    );
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

    if (
      configuration.authorization == 'redis' ||
      !this._applicationConfiguration.firebaseConfig
    ) {
      this._userService = new BackendUserService(
        this._backendApiClient,
        this._storageService,
        configuration.smtp
      );
    } else if (configuration.authorization == 'firebase') {
      firebaseInit(this._applicationConfiguration.firebaseConfig);
      this._userService = new FirebaseUserService(
        this._backendApiClient,
        this._storageService
      );
    } else {
      throw new Error(
        `Unknown backend configuration authorization type: ${configuration.authorization}`
      );
    }
  }

  get userService(): UserService {
    return this._userService;
  }

  get activeProject(): IProject {
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
    let fullUrl = concatenateURLs(
      this._applicationConfiguration.backendApiBase,
      '/system/configuration'
    );
    let request: AxiosRequestConfig = {
      method: 'GET',
      url: fullUrl,
      transformResponse: JSON_FORMAT
    };

    let response = await axios(request);

    if (response.status == 200) {
      return mapBackendConfigResponseToAppFeatures(response.data);
    } else {
      throw new APIError(response, request);
    }
  }

  public async initializeDefaultDestination(): Promise<{
    credentials: PgDatabaseCredentials;
    destinations: DestinationData[];
  }> {
    let credentials: PgDatabaseCredentials = await this._backendApiClient.post(
      '/database',
      {
        projectId: this.activeProject.id
      }
    );
    const destinationData: DestinationData = {
      _type: 'postgres',
      _comment:
        "We set up a test postgres database for you. It's hosted by us and has a 10,000 rows limitation. It's ok" +
        " to try with service with it. However, don't use it in production setup. To reveal credentials, click on the 'Edit' button",
      _id: 'demo_postgres',
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
    };
    const destinations = [destinationData];
    await this._storageService.save(
      'destinations',
      { destinations },
      this.activeProject.id
    );
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

export function mapBackendConfigResponseToAppFeatures(responseData: {
  [key: string]: unknown;
}): FeatureSettings {
  let environment: FeatureSettings['environment'] = responseData.selfhosted
    ? 'custom'
    : 'jitsu_cloud';
  if (responseData.docker_hub_id === 'heroku') {
    environment = 'heroku';
  } else if (
    responseData.docker_hub_id === 'ksense' ||
    responseData.docker_hub_id === 'jitsucom'
  ) {
    environment = 'docker' as const;
  }

  assert(
    responseData.authorization === 'redis' ||
      responseData.authorization === 'firebase'
  );

  assert(typeof responseData.smtp === 'boolean');

  return {
    ...responseData,
    createDemoDatabase: !responseData.selfhosted,
    users: !responseData.selfhosted || !!responseData.users,
    enableCustomDomains: !responseData.selfhosted,
    anonymizeUsers: !!responseData.selfhosted,
    appName: responseData.selfhosted ? 'selfhosted' : 'jitsu_cloud',
    chatSupportType: responseData.selfhosted ? 'slack' : 'chat',
    billingEnabled: !responseData.selfhosted,
    authorization: responseData.authorization,
    smtp: responseData.smtp,
    environment
  };
}

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
  createDemoDatabase: boolean;

  /**
   * If custom domains should be enabled
   */
  enableCustomDomains: boolean;

  /**
   * If statistics we send to Jitsu should be anonymous
   */
  anonymizeUsers: boolean;

  /**
   * Jitsu Domain
   */
  jitsuBaseUrl?: string;

  /**
   * Slack - once user clicks on icon, it should be directed to slack
   *
   */
  chatSupportType: 'slack' | 'chat';

  /**
   * If billing is enabled
   */
  billingEnabled: boolean;

  /**
   * Environment in which Jitsu runs
   */
  environment: 'heroku' | 'docker' | 'jitsu_cloud' | 'custom';
};



