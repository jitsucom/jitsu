import ApplicationServices from "lib/services/ApplicationServices"
import { remove } from "lodash"
import { flowResult, makeAutoObservable } from "mobx"
import { toArrayIfNot } from "utils/arrays"
import { EntitiesStoreState } from "./types.enums"
import { getObjectDepth } from "lib/commons/utils"

type EntityType = "api_keys" | "sources" | "destinations"
type EntityData = ApiKey | SourceData | DestinationData
type ConnectableEntityData<T extends EntityData> = Exclude<EntityData, T>

type EntitySchema<T extends EntityData> = {
  /** Unique id field of the entity */
  idField: string
  /** Field with a list IDs of connected entities. */
  connectedEntitiesFields?: Partial<Record<EntityType, string>>
  /** Tells which entities to exclude from the `store.list` list*/
  hideElements?: (entity: T) => boolean
}

// (!) TO DO: move type to this file
const EDIT_ENTITY_DEFAULT_OPTIONS: EntityUpdateOptions = {
  updateConnections: true,
}

// (!) TO DO: move type to this file
const { IDLE, GLOBAL_LOADING, BACKGROUND_LOADING, GLOBAL_ERROR } = EntitiesStoreState

const services = ApplicationServices.get()

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
  protected _entities: T[] = []
  protected _state: EntitiesStoreState = GLOBAL_ERROR
  protected _errorMessage: string = ""
  protected _connectedStores: EntitiesStore<ConnectableEntityData<T>>[]
  public readonly type: EntityType
  public readonly schema: EntitySchema<T>

  constructor(type: EntityType, schema: EntitySchema<T>) {
    this.type = type
    this.schema = schema
    this.get = this.get.bind(this)
    makeAutoObservable(this)
  }

  protected setError(state: typeof GLOBAL_ERROR, message: string) {
    this._state = state
    this._errorMessage = message
  }

  protected resetError() {
    this._errorMessage = ""
    if (this._state === EntitiesStoreState.GLOBAL_ERROR) this._state = IDLE
  }

  protected getId(entity: T): string {
    return entity[this.schema.idField]
  }

  /** Set a new entities list in the UI */
  protected setEntitiesInStore(allEntities: T[]) {
    this._entities = allEntities
  }

  /** Add a entity in the UI */
  protected addToStore(entity: T): void {
    this._entities.push(entity)
  }

  /** Delete a entity from the UI */
  protected deleteFromStore(id: string): void {
    remove(this._entities, entity => this.getId(entity) === id)
  }

  /** Patch a entity in the UI */
  protected patchInStore(id: string, patch: Partial<T>): void {
    Object.assign(this.get(id), patch)
  }

  /** Replaces a entity data with a passed one in the UI */
  protected replaceEntityInStore(id: string, entity: T) {
    const index = this._entities.findIndex(entity => this.getId(entity) === id)
    if (index >= 0) {
      this._entities[index] = entity
    }
  }

  /**
   * Goes through all entities from connected stores and updates their connections
   * @param _updatedStoreEntities
   * @returns
   */
  private async patchConnectedEntities(_updatedStoreEntities: T | T[]): Promise<void> {
    if (!this._connectedStores) return

    const updatedStoreEntities = toArrayIfNot(_updatedStoreEntities)
    const linkedStoresPatchesMap: { [storeType: string]: { [entityId: string]: Partial<EntityData> } } = {}
    updatedStoreEntities.forEach(entity => {
      this._connectedStores.forEach(store => {
        const linkedEntitiesPatchesMap = linkedStoresPatchesMap[store.type]
        const linkedEntitiesConnectionsField = store.schema.connectedEntitiesFields[this.type]
        store.list.forEach(connectableEntity => {
          const sourceConnectedToEntity = !!source.entities?.includes(entity._uid)
          const sourceNeedsToBeConnected = !!entity._sources?.includes(source.sourceId)
          if (sourceConnectedToEntity === sourceNeedsToBeConnected) {
            return
          }

          const updatedSourcePatch = linkedEntitiesPatchesMap[source.sourceId] || { entities: source.entities }
          if (sourceNeedsToBeConnected) {
            linkedEntitiesPatchesMap[source.sourceId] = {
              entities: [...(updatedSourcePatch.entities || []), entity._uid],
            }
          } else {
            linkedEntitiesPatchesMap[source.sourceId] = {
              entities: (updatedSourcePatch.entities || []).filter(entityUid => entityUid !== entity._uid),
            }
          }
        })
      })
    })
    await Promise.all(
      Object.entries(linkedStoresPatchesMap).map(([sourceId, patch]) =>
        flowResult(this._sourcesStore.patch(sourceId, patch, { updateConnections: false }))
      )
    )
  }

  private async unlinkDeletedFromConnectedEntities(_uids: string | string[]): Promise<void> {
    const entitiesToDeleteUids = toArrayIfNot(_uids)
    const sourcesPatches: { [sourceId: string]: Partial<SourceData> } = {}
    sourcesStore.list.forEach(source => {
      const sourceHasDeletedEntity: boolean = !!intersection(source.entities, entitiesToDeleteUids).length
      if (sourceHasDeletedEntity) {
        sourcesPatches[source.sourceId] = {
          entities: without(source.entities || [], ...entitiesToDeleteUids),
        }
      }
    })
    await Promise.all(
      Object.entries(sourcesPatches).map(([sourceId, patch]) =>
        flowResult(this._sourcesStore.patch(sourceId, patch, { updateConnections: false }))
      )
    )
  }

  public init(connectableEntitiesStores: EntitiesStore<ConnectableEntityData<T>>[]) {
    this._connectedStores = connectableEntitiesStores
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

  public get state() {
    return this._state
  }

  public get error() {
    return this._errorMessage
  }

  public *pullAll(showGlobalLoader?: boolean) {
    this.resetError()
    this._state = showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING
    try {
      const entities = yield services.storageService.table<T>(this.type).getAll()
      this.setEntitiesInStore(entities ?? [])
    } catch (error) {
      this.setError(GLOBAL_ERROR, `Failed to fetch entities: ${error.message || error}`)
    } finally {
      this._state = IDLE
    }
  }

  public get(id: string): T | null {
    return this.list.find(entity => this.getId(entity) === id)
  }

  public *add(entityToAdd: T) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      const addedEntity = yield services.storageService.table<T>(this.type).add(entityToAdd)
      if (!addedEntity) {
        throw new Error(`Entities store failed to add a new entity: ${entityToAdd}`)
      }
      this.addToStore(addedEntity)
      yield this.patchConnectedEntities(addedEntity)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }

  public *delete(id: string) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      yield services.storageService.table<T>(this.type).delete(id)
      this.deleteFromStore(id)
      yield this.unlinkDeletedFromConnectedEntities(id)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }

  public *replace(entity: T, options: EntityUpdateOptions = EDIT_ENTITY_DEFAULT_OPTIONS) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      yield services.storageService.table<T>(this.type).replace(this.getId(entity), entity)
      this.replaceEntityInStore(this.getId(entity), entity)
      if (options.updateConnections) yield this.patchConnectedEntities(entity)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }

  public *patch(id: string, patch: Partial<T>, options: EntityUpdateOptions = EDIT_ENTITY_DEFAULT_OPTIONS) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      if (getObjectDepth(patch) > 2) {
        throw new Error(`Entities recursive patch is not supported`)
      }
      yield services.storageService.table<T>(this.type).patch(id, patch)
      this.patchInStore(id, patch)
      if (options?.updateConnections) this.patchConnectedEntities(this.get(id))
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }
}
