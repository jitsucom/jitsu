import ApplicationServices from "lib/services/ApplicationServices"
import { remove } from "lodash"
import { makeObservable, observable, computed, action, flow } from "mobx"
import { getObjectDepth } from "lib/commons/utils"

export type EntityType = "api_keys" | "sources" | "destinations"
export type EntityData = ApiKey | SourceData | DestinationData
export enum EntitiesStoreStatus {
  "IDLE" = "IDLE",
  "GLOBAL_LOADING" = "GLOBAL_LOADING",
  "BACKGROUND_LOADING" = "BACKGROUND_LOADING",
  "GLOBAL_ERROR" = "GLOBAL_ERROR",
}

type EntitySchema<T extends EntityData> = {
  /** Unique id field of the entity */
  idField: string
  /** Tells which entities to exclude from the `store.list` list*/
  hideElements?: (entity: T) => boolean
}

// (!) TO DO: move type to this file
const { IDLE, GLOBAL_LOADING, BACKGROUND_LOADING, GLOBAL_ERROR } = EntitiesStoreStatus

/**
 * Generic entities store class for manipulating objects.
 *
 * Methods of this class both make API calls and update the subscribed UI components.
 *
 * For creating a new store either instantiate this class or a class that extends this one:
 * @example
 * // Using EntitiesStore class
 * const apiKeysStore = new EntitiesStore("api_keys", {idField: "uid"})
 *
 * // Using an extended class
 * const destinationsStore = new DestinationsStore()
 * class DestinationsStore extends EntitiesStore<DestinationData> {
 *   constructor() {
 *     super("destinations", {
 *       idField: "_uid",
 *       connectedEntitiesFields: { sources: "_sources", api_keys: "_only_keys" },
 *       hideElements: dst => destinationsReferenceMap[dst._type]?.hidden,
 *     })
 *   }
 *
 *   public someDestinationsSpecificMethod() {
 *    // logic
 *   }
 * }
 **/
export class EntitiesStore<T extends EntityData> {
  protected _initialized: boolean = false
  protected _state: { status: EntitiesStoreStatus; errorMessage: string } = observable({
    status: IDLE,
    errorMessage: "",
  })
  protected readonly type: EntityType
  protected readonly schema: EntitySchema<T>
  protected readonly services: ApplicationServices

  _entities: T[] = []

  constructor(type: EntityType, schema: EntitySchema<T>) {
    this.type = type
    this.schema = schema
    this.services = ApplicationServices.get()
    this.get = this.get.bind(this)
    makeObservable(this, {
      _entities: observable,
      status: computed,
      errorMessage: computed,
      list: computed,
      listHidden: computed,
      listIncludeHidden: computed,
      get: action.bound,
      pullAll: flow.bound,
      add: flow.bound,
      delete: flow.bound,
      replace: flow.bound,
      patch: flow.bound,
    })
  }

  protected setStatus(status: EntitiesStoreStatus) {
    this._state.status = status
  }

  protected setError(message: string) {
    this._state.status = GLOBAL_ERROR
    this._state.errorMessage = message
  }

  protected resetError() {
    this._state.errorMessage = ""
    this._state.status = IDLE
  }

  protected getId(entity: T): string {
    return entity[this.schema.idField]
  }

  public get list() {
    return this.schema.hideElements
      ? this._entities.filter(element => !this.schema.hideElements(element))
      : this._entities
  }

  public get listHidden() {
    return this.schema.hideElements ? this._entities.filter(element => this.schema.hideElements(element)) : []
  }

  public get listIncludeHidden() {
    return this._entities
  }

  public get status() {
    return this._state.status
  }

  public get isInitialized(): boolean {
    return this._initialized
  }

  public get errorMessage() {
    return this._state.errorMessage
  }

  public get(id: string): T | null {
    return this.list.find(entity => this.getId(entity) === id)
  }

  public *pullAll(options?: { showGlobalLoader?: boolean }) {
    const { showGlobalLoader } = options ?? { showGlobalLoader: false }
    this.resetError()
    this.setStatus(showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING)
    try {
      const entities = yield this.services.storageService.table<T>(this.type).getAll()
      this._entities = entities ?? []
      this._initialized = true
    } catch (error) {
      this.setError(`Failed to fetch ${this.type}: ${error.message || error}`)
    } finally {
      this.setStatus(IDLE)
    }
  }

  public *add(entityToAdd: T): Generator<any, T | null, T | null> {
    this.resetError()
    this.setStatus(BACKGROUND_LOADING)
    try {
      const addedEntity = yield this.services.storageService.table<T>(this.type).add(entityToAdd)
      if (!addedEntity) {
        throw new Error(`Error: '${this.type}' store failed to add an entity ${entityToAdd}`)
      }
      this._entities.push(addedEntity)
      return addedEntity
    } finally {
      this.setStatus(IDLE)
    }
  }

  public *delete(id: string) {
    this.resetError()
    this.setStatus(BACKGROUND_LOADING)
    try {
      yield this.services.storageService.table<T>(this.type).delete(id)
      remove(this._entities, entity => this.getId(entity) === id)
    } finally {
      this.setStatus(IDLE)
    }
  }

  public *replace(entity: T) {
    this.resetError()
    this.setStatus(BACKGROUND_LOADING)
    try {
      const index = this._entities.findIndex(item => this.getId(item) === this.getId(entity))
      if (index >= 0) {
        yield this.services.storageService.table<T>(this.type).replace(this.getId(entity), entity)
        this._entities[index] = entity
      } else {
        throw new Error(`Error: ${this.type} store failed to replace entity in store. Entity: ${entity}`)
      }
    } finally {
      this.setStatus(IDLE)
    }
  }

  public *patch(id: string, patch: Partial<T>) {
    this.resetError()
    this.setStatus(BACKGROUND_LOADING)
    try {
      if (getObjectDepth(patch) > 2) {
        throw new Error(`Entities recursive patch is not supported`)
      }
      yield this.services.storageService.table<T>(this.type).patch(id, patch)
      Object.assign(this.get(id), patch)
    } finally {
      this.setStatus(IDLE)
    }
  }
}
