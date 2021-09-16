import { getBackendApiBase } from 'lib/commons/pathHelper';
import { concatenateURLs } from 'lib/commons/utils';

type AppEnvironmentType = 'development' | 'production';

export class ApplicationConfiguration {
  private readonly _rawConfig: RawConfigObject;
  private readonly _firebaseConfig: any;
  private readonly _backendApiBase: string;
  private readonly _backendApiProxyBase: string;
  private readonly _billingApiBase: string;
  /**
   * One of the following: `development`, `production`
   */
  private readonly _appEnvironment: AppEnvironmentType;
  private readonly _buildId: string;

  constructor() {
    this._rawConfig = getRawApplicationConfig();
    this._firebaseConfig = this._rawConfig.firebase;
    const backendApi = getBackendApiBase(this._rawConfig.env);
    this._backendApiBase = concatenateURLs(backendApi, '/api/v1');
    this._backendApiProxyBase = concatenateURLs(backendApi, '/proxy/api/v1');
    const billingApi = this._rawConfig.billingApi;
    this._billingApiBase = concatenateURLs(billingApi, '/api');
    this._appEnvironment = (
      this._rawConfig.env.NODE_ENV || 'production'
    ).toLowerCase() as AppEnvironmentType;
    this._buildId = [
      `b=${this._rawConfig.env.BUILD_ID || 'dev'}`,
      `sc=${this._rawConfig.env.GIT_BRANCH || 'unknown'}/${
        this._rawConfig.env.GIT_COMMIT_REF || 'unknown'
      }`,
      `t=${this._rawConfig.env.BUILD_TIMESTAMP || 'unknown'}`
    ].join(';');

    console.log(
      `App initialized. Backend: ${this._backendApiBase}. Env: ${
        this._appEnvironment
      }. Firebase configured: ${!!this._firebaseConfig}. Build info: ${
        this._buildId
      }`
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

  get billingApiBase(): string {
    return this._billingApiBase;
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
  billingApi: string;
};

function getRawApplicationConfig(): RawConfigObject {
  return {
    env: process.env || {},
    firebase: parseJson(process.env.FIREBASE_CONFIG, null),
    keys: parseJson(process.env.ANALYTICS_KEYS, {}),
    billingApi: process.env.BILLING_API_BASE_URL
  };
}

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
