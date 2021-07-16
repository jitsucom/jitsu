// @Libs
import { flowResult, makeAutoObservable } from 'mobx';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
import { isArray } from 'utils/typeCheck';
// @Utils
import { randomId } from 'utils/numbers';

export type UserApiKey = {
  uid: string;
  jsAuth: string;
  serverAuth: string;
  origins?: string[];
  comment?: string;
};

interface IApiKeysStore {
  apiKeys: UserApiKey[];
  state: ApiKeysStoreState;
  error: string;
  generateApiToken(type: string, len?: number): string;
  pullApiKeys: (
    showGlobalLoader: boolean
  ) => Generator<Promise<unknown>, void, unknown>;
  generateAddInitialApiKeyIfNeeded: () => Generator<
    Promise<unknown>,
    void,
    unknown
  >;
  generateAddApiKey: () => Generator<Promise<unknown>, void, unknown>;
  deleteApiKey: (
    apiKey: UserApiKey
  ) => Generator<Promise<unknown>, void, unknown>;
  editApiKeys: (
    newData: UserApiKey | UserApiKey[]
  ) => Generator<Promise<unknown>, void, unknown>;
}

enum ApiKeyStoreGeneralState {
  'IDLE' = 'IDLE'
}

enum ApiKeysStoreLoadingState {
  'GLOBAL_LOADING' = 'GLOBAL_LOADING',
  'BACKGROUND_LOADING' = 'BACKGROUND_LOADING'
}

enum ApiKeyStoreErroredState {
  'GLOBAL_ERROR' = 'GLOBAL_ERROR'
}

export const ApiKeysStoreState = {
  ...ApiKeyStoreGeneralState,
  ...ApiKeysStoreLoadingState,
  ...ApiKeyStoreErroredState
};

export type ApiKeysStoreState =
  typeof ApiKeysStoreState[keyof typeof ApiKeysStoreState];

const { IDLE, GLOBAL_LOADING, BACKGROUND_LOADING, GLOBAL_ERROR } =
  ApiKeysStoreState;

const services = ApplicationServices.get();

class ApiKeysStore implements IApiKeysStore {
  private _apiKeys: UserApiKey[] = [];
  private _state: ApiKeysStoreState = GLOBAL_LOADING;
  private _errorMessage: string = '';

  constructor() {
    makeAutoObservable(this);
  }

  private setError(state: ApiKeyStoreErroredState, message: string) {
    this._state = state;
    this._errorMessage = message;
  }

  private resetError() {
    this._errorMessage = '';
    const stateIsErrored = Object.values(ApiKeyStoreErroredState).includes(
      this._state as any
    );
    if (stateIsErrored) this._state = IDLE;
  }

  private generateApiKey(): UserApiKey {
    return {
      uid: this.generateApiToken('', 6),
      serverAuth: this.generateApiToken('s2s'),
      jsAuth: this.generateApiToken('js'),
      origins: []
    };
  }

  public get apiKeys() {
    return this._apiKeys;
  }

  public get state() {
    return this._state;
  }

  public get error() {
    return this._errorMessage;
  }

  public generateApiToken(type: string, len?: number): string {
    const postfix = `${ApplicationServices.get().activeProject.id}.${randomId(
      len
    )}`;
    return type.length > 0 ? `${type}.${postfix}` : postfix;
  }

  public *pullApiKeys(showGlobalLoader?: boolean) {
    this.resetError();
    this._state = showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING;
    try {
      const { keys } = yield services.storageService.get(
        'api_keys',
        services.activeProject.id
      );
      this._apiKeys = keys || [];
    } catch (error) {
      this.setError(
        GLOBAL_ERROR,
        `Failed to fetch apiKeys: ${error.message || error}`
      );
    } finally {
      this._state = IDLE;
    }
  }

  public *generateAddInitialApiKeyIfNeeded() {
    if (!!this.apiKeys.length) return;
    yield flowResult(this.generateAddApiKey);
  }

  public *generateAddApiKey() {
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const newApiKey = this.generateApiKey();
    const updatedApiKeys = [...this._apiKeys, newApiKey];
    try {
      const result = yield services.storageService.save(
        'api_keys',
        { keys: updatedApiKeys },
        services.activeProject.id
      );
      this._apiKeys = updatedApiKeys;
    } catch (error) {
      throw error;
    } finally {
      this._state = IDLE;
    }
  }

  public *deleteApiKey(apiKeyToDelete: UserApiKey) {
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const updatedApiKeys = this._apiKeys.filter(
      ({ uid }) => uid !== apiKeyToDelete.uid
    );
    try {
      const result = yield services.storageService.save(
        'api_keys',
        { keys: updatedApiKeys },
        services.activeProject.id
      );
      this._apiKeys = updatedApiKeys;
    } catch (error) {
      throw error;
    } finally {
      this._state = IDLE;
    }
  }

  public *editApiKeys(_apiKeysToUpdate: UserApiKey | UserApiKey[]) {
    const apiKeysToUpdate: UserApiKey[] = isArray(_apiKeysToUpdate)
      ? _apiKeysToUpdate
      : [_apiKeysToUpdate];

    this.resetError();
    this._state = BACKGROUND_LOADING;
    const updatedApiKeys = this._apiKeys.map((apiKey) => {
      const updateCandidate = apiKeysToUpdate.find(
        (updateCandidate) => updateCandidate.uid === apiKey.uid
      );
      if (!updateCandidate) return apiKey;
      return updateCandidate;
    });
    try {
      const result = yield services.storageService.save(
        'api_keys',
        { keys: updatedApiKeys },
        services.activeProject.id
      );
      this._apiKeys = updatedApiKeys;
    } catch (error) {
      throw error;
    } finally {
      this._state = IDLE;
    }
  }
}

export const apiKeysStore = new ApiKeysStore();
