// @Libs
import { flowResult, makeAutoObservable } from "mobx"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Utils
import { randomId } from "utils/numbers"
import { toArrayIfNot } from "utils/arrays"
import { IDestinationsStore } from "./destinations"
import { intersection, remove, without } from "lodash"
import { EntitiesStoreState } from "./types.enums"
import { getObjectDepth } from "lib/commons/utils"

type AddAPIKeyOptions = {
  note?: string
}
export interface IApiKeysStore extends EntitiesStore<ApiKey> {
  firstLinkedKey: ApiKey | null
  hasApiKeys: boolean
  state: EntitiesStoreState
  error: string
  injectDestinationsStore: (store: IDestinationsStore) => void
  generateApiToken(type: string, len?: number): string
  pullApiKeys: (showGlobalLoader: boolean) => Generator<Promise<unknown>, void, unknown>
  generateAddInitialApiKeyIfNeeded: (optinons?: AddAPIKeyOptions) => Generator<Promise<unknown>, void, unknown>
  add: (key?: Partial<ApiKey>) => Generator<Promise<unknown>, void, unknown>
}

const { IDLE, GLOBAL_LOADING, BACKGROUND_LOADING, GLOBAL_ERROR } = EntitiesStoreState

const services = ApplicationServices.get()

class ApiKeysStore implements IApiKeysStore {
  private _apiKeys: ApiKey[] = []
  private _state: EntitiesStoreState = GLOBAL_LOADING
  private _errorMessage: string = ""
  private _destinationsStore: IDestinationsStore | undefined

  constructor() {
    makeAutoObservable(this)
  }

  private setError(state: EntitiesStoreState.GLOBAL_ERROR, message: string) {
    this._state = state
    this._errorMessage = message
  }

  private resetError() {
    this._errorMessage = ""
    const stateIsErrored = [EntitiesStoreState.GLOBAL_ERROR].includes(this._state as any)
    if (stateIsErrored) this._state = IDLE
  }

  /** Set a new apiKeys list in the UI */
  private setApiKeysToStore(apiKeysList: ApiKey[]): void {
    this._apiKeys = apiKeysList
  }

  /** Add a apiKey in the UI */
  private addApiKeyToStore(apiKey: ApiKey): void {
    this._apiKeys.push(apiKey)
  }

  /** Delete a apiKey from the UI */
  private deleteApiKeyFromStore(id: string): void {
    remove(this._apiKeys, apiKey => apiKey.uid === id)
  }

  /** Patch a apiKey in the UI */
  private patchApiKeyInStore(id: string, patch: Partial<ApiKey>): void {
    Object.assign(this.get(id), patch)
  }

  /** Replaces a apiKey data with a passed one in the UI */
  private replaceApiKey(id: string, apiKey: ApiKey) {
    const index = this._apiKeys.findIndex(({ uid }) => uid === id)
    if (index >= 0) {
      this._apiKeys[index] = apiKey
    }
  }

  private generateApiKey(comment?: string): ApiKey {
    return {
      uid: this.generateApiToken("", 6),
      serverAuth: this.generateApiToken("s2s"),
      jsAuth: this.generateApiToken("js"),
      comment,
      origins: [],
    }
  }

  private async removeDeletedApiKeysFromDestinations(uids: string | string[]): Promise<void> {
    const deletedApiKeysUids = toArrayIfNot(uids)
    const destinationPatches: { [destUid: string]: Partial<DestinationData> } = {}

    this._destinationsStore.listIncludeHidden.forEach(destination => {
      const destinationHasDeletedKeys: boolean = !!intersection(destination._onlyKeys, deletedApiKeysUids).length
      if (destinationHasDeletedKeys) {
        destinationPatches[destination._uid] = {
          _onlyKeys: without(destination._onlyKeys, ...deletedApiKeysUids),
        }
      }
    })

    await Promise.all(
      Object.entries(destinationPatches).map(([destUid, patch]) =>
        flowResult(this._destinationsStore.patch(destUid, patch, { updateConnections: false }))
      )
    )
  }

  public get list() {
    return this._apiKeys ?? []
  }

  public get firstLinkedKey() {
    const firstLinkedDestination = this._destinationsStore.listIncludeHidden.find(({ _onlyKeys }) => _onlyKeys.length)
    if (!firstLinkedDestination) return null
    return this.get(firstLinkedDestination._onlyKeys[0])
  }

  public get hasApiKeys(): boolean {
    return !!this._apiKeys.length
  }

  public get state() {
    return this._state
  }

  public get error() {
    return this._errorMessage
  }

  public injectDestinationsStore(store: IDestinationsStore): void {
    this._destinationsStore = store
  }

  public get(uid: string): ApiKey | null {
    return this.list.find(key => key.uid === uid) || null
  }

  public generateApiToken(type: string, len?: number): string {
    const postfix = `${ApplicationServices.get().activeProject.id}.${randomId(len)}`
    return type.length > 0 ? `${type}.${postfix}` : postfix
  }

  public *pullApiKeys(showGlobalLoader?: boolean) {
    this.resetError()
    this._state = showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING
    try {
      const keys = yield services.storageService.table<ApiKey>("api_keys").getAll()
      this.setApiKeysToStore(keys ?? [])
    } catch (error) {
      this.setError(GLOBAL_ERROR, `Failed to fetch apiKeys: ${error.message || error}`)
    } finally {
      this._state = IDLE
    }
  }

  public *generateAddInitialApiKeyIfNeeded(options?: AddAPIKeyOptions) {
    if (!!this.list.length) return
    yield flowResult(this.add({ comment: options?.note }))
  }

  public *add(key?: Partial<ApiKey>) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    const newApiKey: ApiKey = { ...this.generateApiKey(key.comment), ...(key ?? {}) }
    try {
      const addedApiKey = yield services.storageService.table<ApiKey>("api_keys").add(newApiKey)
      if (!addedApiKey) {
        throw new Error(`API keys store failed to add a new key: ${newApiKey}`)
      }
      this.addApiKeyToStore(addedApiKey)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }

  public *delete(uid: string) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      yield services.storageService.table<ApiKey>("api_keys").delete(uid)
      this.deleteApiKeyFromStore(uid)
      yield this.removeDeletedApiKeysFromDestinations(uid)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }

  public *replace(apiKeyToUpdate: ApiKey) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      yield services.storageService.table<ApiKey>("api_keys").replace(apiKeyToUpdate.uid, apiKeyToUpdate)
      this.replaceApiKey(apiKeyToUpdate.uid, apiKeyToUpdate)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }

  public *patch(uid: string, patch: Partial<ApiKey>) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      if (getObjectDepth(patch) > 2) {
        throw new Error(`API Keys recursive patch is not supported`)
      }
      yield services.storageService.table<ApiKey>("api_keys").patch(uid, patch)
      this.patchApiKeyInStore(uid, patch)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }
}



export const apiKeysStore = new ApiKeysStore()
