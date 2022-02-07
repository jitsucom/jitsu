// @Libs
import { flowResult, makeAutoObservable } from "mobx"
// @Services
import ApplicationServices from "lib/services/ApplicationServices"
// @Utils
import { intersection, merge, remove, union, without } from "lodash"
import { toArrayIfNot } from "utils/arrays"
import { ISourcesStore, sourcesStore } from "./sources"
import { apiKeysStore, IApiKeysStore } from "./apiKeys"
import { destinationsReferenceMap, DestinationReference } from "@jitsu/catalog/destinations/lib"
import { EntitiesStoreState } from "stores/types.enums"

export interface IDestinationsStore extends EntitiesStore<DestinationData> {
  state: EntitiesStoreState
  error: string
  listHidden: DestinationData[]
  listIncludeHidden: DestinationData[]
  injectSourcesStore: (sourcesStore: ISourcesStore) => void
  getDestinationReferenceById: (id: string) => DestinationReference | null
  pullDestinations: (showGlobalLoader: boolean) => Generator<Promise<unknown>, void, unknown>
  createFreeDatabase: () => Generator<Promise<unknown>, void, unknown>
  linkApiKeysToDestinations: (
    apiKeysUids: string | string[],
    destinationsUids: string | string[]
  ) => Generator<Promise<unknown>, void, unknown>
}

const EDIT_DESTINATIONS_DEFAULT_OPTIONS: EntityUpdateOptions = {
  updateConnections: true,
}

const { IDLE, GLOBAL_LOADING, BACKGROUND_LOADING, GLOBAL_ERROR } = EntitiesStoreState

const services = ApplicationServices.get()
class DestinationsStore implements IDestinationsStore {
  private _destinations: DestinationData[] = []
  private _hiddenDestinations: DestinationData[] = []
  private _state: EntitiesStoreState = GLOBAL_ERROR
  private _errorMessage: string = ""
  private _sourcesStore: ISourcesStore | undefined
  private _apiKeysStore: IApiKeysStore = apiKeysStore

  constructor() {
    makeAutoObservable(this)
  }

  private setError(state: typeof GLOBAL_ERROR, message: string) {
    this._state = state
    this._errorMessage = message
  }

  private resetError() {
    this._errorMessage = ""
    if (this._state === EntitiesStoreState.GLOBAL_ERROR) this._state = IDLE
  }

  /** Set a new destinations list in the UI */
  private setDestinations(value: DestinationData[]) {
    this._destinations = this.filterDestinations(value, false)
    this._hiddenDestinations = this.filterDestinations(value, true)
  }

  private filterDestinations(destinations: DestinationData[], hidden: boolean) {
    return destinations ? destinations.filter(v => destinationsReferenceMap[v._type]?.hidden == hidden) : []
  }

  /** Add a destination in the UI */
  private addToStore(destination: DestinationData): void {
    this._destinations.push(destination)
  }

  /** Delete a destination from the UI */
  private deleteFromStore(id: string): void {
    remove(this._destinations, ({ _uid }) => _uid === id)
  }

  /** Patch a destination in the UI */
  private patchInStore(id: string, patch: Partial<DestinationData>): DestinationData {
    const destinationToPatch = this.get(id)
    merge(destinationToPatch, patch)
    return destinationToPatch
  }

  /** Replaces a destination data with a passed one in the UI */
  private replaceDestination(id: string, destination: DestinationData) {
    const index = this._destinations.findIndex(({ _uid }) => _uid === id)
    if (index >= 0) {
      this._destinations[index] = destination
    }
  }

  private async patchSourcesLinksByDestinationsUpdates(
    _updatedDestinations: DestinationData | DestinationData[]
  ): Promise<void> {
    const updatedDestinations = toArrayIfNot(_updatedDestinations)
    const sourcesPatchesMap: { [key: string]: Partial<SourceData> } = {}
    updatedDestinations.forEach(destination => {
      this._sourcesStore.list.forEach(source => {
        const sourceLinkedToDestination = !!source.destinations?.includes(destination._uid)
        const sourceNeedsToBeLinked = !!destination._sources?.includes(source.sourceId)
        if (sourceLinkedToDestination === sourceNeedsToBeLinked) return
        const updatedSourcePatch = sourcesPatchesMap[source.sourceId] || { destinations: source.destinations }
        if (sourceNeedsToBeLinked) {
          sourcesPatchesMap[source.sourceId] = {
            destinations: [...(updatedSourcePatch.destinations || []), destination._uid],
          }
        } else {
          sourcesPatchesMap[source.sourceId] = {
            destinations: (updatedSourcePatch.destinations || []).filter(
              destinationUid => destinationUid !== destination._uid
            ),
          }
        }
      })
    })
    await Promise.all(
      Object.entries(sourcesPatchesMap).map(([sourceId, patch]) =>
        flowResult(this._sourcesStore.patch(sourceId, patch, { updateConnections: false }))
      )
    )
  }

  private async unlinkDeletedDestinationsFromSources(_uids: string | string[]): Promise<void> {
    const destinationsToDeleteUids = toArrayIfNot(_uids)
    const sourcesPatches: { [sourceId: string]: Partial<SourceData> } = {}
    sourcesStore.list.forEach(source => {
      const sourceHasDeletedDestination: boolean = !!intersection(source.destinations, destinationsToDeleteUids).length
      if (sourceHasDeletedDestination) {
        sourcesPatches[source.sourceId] = {
          destinations: without(source.destinations || [], ...destinationsToDeleteUids),
        }
      }
    })
    await Promise.all(
      Object.entries(sourcesPatches).map(([sourceId, patch]) =>
        flowResult(this._sourcesStore.patch(sourceId, patch, { updateConnections: false }))
      )
    )
  }

  public injectSourcesStore(sourcesStore: ISourcesStore): void {
    this._sourcesStore = sourcesStore
  }

  public get list() {
    return this._destinations
  }

  public get listHidden() {
    return this._hiddenDestinations
  }

  public get listIncludeHidden() {
    return [...this._destinations, ...this._hiddenDestinations]
  }

  public get state() {
    return this._state
  }

  public get error() {
    return this._errorMessage
  }

  public get(id: string): DestinationData | null {
    return this._destinations.find(({ _id }) => _id === id)
  }

  public getDestinationReferenceById(id: string): DestinationReference | null {
    const destination: DestinationData | null = this.get(id)
    return destination ? destinationsReferenceMap[destination._type] : null
  }

  public *pullDestinations(showGlobalLoader?: boolean) {
    this.resetError()
    this._state = showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING
    try {
      const { destinations } = yield services.storageService.table<DestinationData>("destinations").getAll()
      this.setDestinations(destinations)
    } catch (error) {
      this.setError(GLOBAL_ERROR, `Failed to fetch destinations: ${error.message || error}`)
    } finally {
      this._state = IDLE
    }
  }

  public *add(destinationToAdd: DestinationData) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    const updatedDestinations = [...this.listIncludeHidden, destinationToAdd]
    try {
      const addedDestination = yield services.storageService
        .table<DestinationData>("destinations")
        .add(destinationToAdd)
      this.addToStore(addedDestination)
      yield this.patchSourcesLinksByDestinationsUpdates(addedDestination)
    } finally {
      this._state = IDLE
    }
  }

  public *delete(_uid: string) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      yield services.storageService.table<DestinationData>("destinations").delete(_uid)
      this.deleteFromStore
      yield this.unlinkDeletedDestinationsFromSources(_uid)
    } finally {
      this._state = IDLE
    }
  }

  public *replace(destination: DestinationData, options: EntityUpdateOptions = EDIT_DESTINATIONS_DEFAULT_OPTIONS) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      yield services.storageService.table<DestinationData>("destinations").replace(destination._uid, destination)
      this.replaceDestination(destination._uid, destination)
      if (options.updateConnections) yield this.patchSourcesLinksByDestinationsUpdates(destination)
    } finally {
      this._state = IDLE
    }
  }

  public *patch(
    id: string,
    patch: Partial<DestinationData>,
    options: EntityUpdateOptions = EDIT_DESTINATIONS_DEFAULT_OPTIONS
  ) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      yield services.storageService.table<DestinationData>("destinations").patch(id, patch)
      const patched = this.patchInStore(id, patch)
      if (options?.updateConnections) this.patchSourcesLinksByDestinationsUpdates(patched)
    } finally {
      this._state = IDLE
    }
  }

  public *createFreeDatabase() {
    const { destinations } = (yield services.initializeDefaultDestination()) as {
      destinations: DestinationData[]
    }
    const freeDatabaseDestination = destinations[0]
    yield flowResult(this._apiKeysStore.generateAddInitialApiKeyIfNeeded())
    const linkedFreeDatabaseDestination: DestinationData = {
      ...freeDatabaseDestination,
      _onlyKeys: [this._apiKeysStore.list[0].uid],
    }
    yield flowResult(this.add(linkedFreeDatabaseDestination))
  }

  public *linkApiKeysToDestinations(_apiKeysUids: string | string[], _destinationsUids: string | string[]) {
    const apiKeysUids = toArrayIfNot(_apiKeysUids)
    const destinations = toArrayIfNot(_destinationsUids).map(this.get)
    const destinationsPatches: { [destinationUid: string]: Partial<DestinationData> } = {}

    destinations.forEach(destination => {
      destinationsPatches[destination._uid] = {
        _onlyKeys: union(destination._onlyKeys, apiKeysUids),
      }
    })

    yield Promise.all(
      Object.entries(destinationsPatches).map(([destinationUid, patch]) =>
        flowResult(this.patch(destinationUid, patch, { updateConnections: false }))
      )
    )
  }
}

export const destinationsStore = new DestinationsStore()
