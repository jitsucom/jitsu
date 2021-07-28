// @Libs
import { flowResult, makeAutoObservable } from 'mobx';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
import { isArray } from 'utils/typeCheck';
// @Utils
import { randomId } from 'utils/numbers';
import { toArrayIfNot } from 'utils/arrays';
import { IDestinationsStore } from './destinations';
import { intersection, without } from 'lodash';

export type UserApiKey = {
  uid: string;
  jsAuth: string;
  serverAuth: string;
  origins?: string[];
  comment?: string;
};

export interface IApiKeysStore {
  apiKeys: UserApiKey[];
  firstLinkedKey: UserApiKey | null;
  hasApiKeys: boolean;
  state: ApiKeysStoreState;
  error: string;
  injectDestinationsStore: (store: IDestinationsStore) => void;
  getKeyByUid: (uid: string) => UserApiKey | null;
  generateApiToken(type: string, len?: number): string;
  pullApiKeys: (
    showGlobalLoader: boolean
  ) => Generator<Promise<unknown>, void, unknown>;
  generateAddInitialApiKeyIfNeeded: (
    note?: string
  ) => Generator<Promise<unknown>, void, unknown>;
  generateAddApiKey: (
    note?: string
  ) => Generator<Promise<unknown>, void, unknown>;
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
  private _destinationsStore: IDestinationsStore | undefined;

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

  private generateApiKey(comment?: string): UserApiKey {
    return {
      uid: this.generateApiToken('', 6),
      serverAuth: this.generateApiToken('s2s'),
      jsAuth: this.generateApiToken('js'),
      comment,
      origins: []
    };
  }

  private removeDeletedApiKeysFromDestinations(
    _deletedApiKeys: UserApiKey | UserApiKey[]
  ) {
    const deletedApiKeysUids = toArrayIfNot(_deletedApiKeys).map(
      (key) => key.uid
    );
    const updatedDestinationsInitialAccumulator: DestinationData[] = [];
    const updatedDestinations: DestinationData[] =
      this._destinationsStore.destinations.reduce(
        (updatedDestinations, destination) => {
          const destinationHasDeletedKeys = !!intersection(
            destination._onlyKeys,
            deletedApiKeysUids
          ).length;
          if (!destinationHasDeletedKeys) return updatedDestinations;
          const updated: DestinationData = {
            ...destination,
            _onlyKeys: without(destination._onlyKeys, ...deletedApiKeysUids)
          };
          return [...updatedDestinations, updated];
        },
        updatedDestinationsInitialAccumulator
      );
    if (updatedDestinations.length)
      this._destinationsStore.editDestinations(updatedDestinations, {
        updateSources: false
      });
  }

  public get apiKeys() {
    return this._apiKeys;
  }

  public get firstLinkedKey() {
    const firstLinkedDestination = this._destinationsStore.destinations.find(
      ({ _onlyKeys }) => _onlyKeys.length
    );
    if (!firstLinkedDestination) return null;
    return this.getKeyByUid(firstLinkedDestination._onlyKeys[0]);
  }

  public get hasApiKeys(): boolean {
    return !!this._apiKeys.length;
  }

  public get state() {
    return this._state;
  }

  public get error() {
    return this._errorMessage;
  }

  public injectDestinationsStore(store: IDestinationsStore): void {
    this._destinationsStore = store;
  }

  public getKeyByUid(uid: string): UserApiKey | null {
    return this.apiKeys.find((key) => key.uid === uid) || null;
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

  public *generateAddInitialApiKeyIfNeeded(note?: string) {
    if (!!this.apiKeys.length) return;
    yield flowResult(this.generateAddApiKey(note));
  }

  public *generateAddApiKey(note?: string) {
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const newApiKey = this.generateApiKey(note);
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
      this.removeDeletedApiKeysFromDestinations(apiKeyToDelete);
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
