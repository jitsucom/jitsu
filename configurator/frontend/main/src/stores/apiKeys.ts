// @Libs
import { flowResult, makeObservable, flow, override } from "mobx"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Utils
import { randomId } from "utils/numbers"
import { EntitiesStore, EntitiesStoreStatus } from "./entitiesStore"

//const services = ApplicationServices.get()
export class ApiKeysStore extends EntitiesStore<ApiKey> {
  protected readonly services: ApplicationServices

  constructor() {
    super("api_keys", { idField: "uid" })
    this.services = ApplicationServices.get()
    makeObservable(this, {
      add: override,
      generateAddInitialApiKeyIfNeeded: flow,
    })
  }

  public *add(key?: Partial<ApiKey>): Generator<any, ApiKey, ApiKey> {
    this.resetError()
    this.setStatus(EntitiesStoreStatus.BACKGROUND_LOADING)
    const newApiKey: ApiKey = { ...this.generateApiKey(key.comment), ...(key ?? {}) }
    try {
      const addedApiKey = yield this.services.storageService.table<ApiKey>("api_keys").add(newApiKey)
      if (!addedApiKey) {
        throw new Error(`API keys store failed to add a new key: ${newApiKey}`)
      }
      this._entities.push(addedApiKey)
      return addedApiKey
    } finally {
      this.setStatus(EntitiesStoreStatus.IDLE)
    }
  }

  public generateApiKey(comment?: string): ApiKey {
    return {
      uid: this.generateApiToken("", 6),
      serverAuth: this.generateApiToken("s2s"),
      jsAuth: this.generateApiToken("js"),
      comment,
      origins: [],
    }
  }

  public generateApiToken(type: string, len?: number): string {
    const postfix = `${ApplicationServices.get().activeProject.id}.${randomId(len)}`
    return type.length > 0 ? `${type}.${postfix}` : postfix
  }

  public *generateAddInitialApiKeyIfNeeded(options?: { note?: string }) {
    if (!!this.list.length) return
    yield flowResult(this.add({ comment: options?.note }))
  }
}

export const apiKeysStore = new ApiKeysStore()
