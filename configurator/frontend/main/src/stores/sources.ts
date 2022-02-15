// @Libs
import { flowResult, makeAutoObservable } from "mobx"
// @Store
import { IDestinationsStore } from "./destinations"
// @Services
import ApplicationServices, { IApplicationServices } from "lib/services/ApplicationServices"
// @Utils
import { intersection, merge, remove, without } from "lodash"
import { toArrayIfNot } from "utils/arrays"
import { EntitiesStoreState } from "stores/types.enums"
import { getObjectDepth } from "lib/commons/utils"

export interface ISourcesStore extends EntitiesStore<SourceData> {
  state: EntitiesStoreState
  error: string
  pullSources: (showGlobalLoader: boolean) => Generator<Promise<unknown>, void, unknown> // move to init
}

const EDIT_SOURCES_DEFAULT_OPTIONS: EntityUpdateOptions = {
  updateConnections: true,
} as const

const { IDLE, GLOBAL_LOADING, BACKGROUND_LOADING, GLOBAL_ERROR } = EntitiesStoreState

class SourcesStore implements ISourcesStore {
  private _sources: SourceData[] = []
  private _state: EntitiesStoreState = GLOBAL_LOADING
  private _errorMessage: string = ""
  private _destinationsStore: IDestinationsStore | undefined
  private services: IApplicationServices = ApplicationServices.get()

  constructor() {
    makeAutoObservable(this)
  }

  private setError(state: EntitiesStoreState.GLOBAL_ERROR, message: string): void {
    this._state = state
    this._errorMessage = message
  }

  private resetError(): void {
    this._errorMessage = ""
    if (this._state === EntitiesStoreState.GLOBAL_ERROR) this._state = IDLE
  }

  /** Set a new sources list in the UI */
  private setSourcesInStore(sourcesList: SourceData[]): void {
    this._sources = sourcesList
  }

  /** Add a source in the UI */
  private addToStore(source: SourceData): void {
    this._sources.push(source)
  }

  /** Delete a source from the UI */
  private deleteFromStore(id: string): void {
    remove(this._sources, source => source.sourceId === id)
  }

  /** Patch a source in the UI */
  private patchInStore(id: string, patch: Partial<SourceData>): void {
    Object.assign(this.get(id), patch)
  }

  /** Replaces a source data with a passed one in the UI */
  private replaceSource(id: string, source: SourceData) {
    const index = this._sources.findIndex(({ sourceId }) => sourceId === id)
    if (index >= 0) {
      this._sources[index] = source
    }
  }

  private async patchDestinationsLinksBySourcesUpdates(_updatedSources: SourceData | SourceData[]): Promise<void> {
    const updatedSources: SourceData[] = toArrayIfNot(_updatedSources)
    const destinationsPatchesMap: { [key: string]: Partial<DestinationData> } = {}
    updatedSources.forEach(source => {
      this._destinationsStore.listIncludeHidden.forEach(destination => {
        const destinationIsLinkedToSoucre = !!destination._sources?.includes(source.sourceId)
        const destinationNeedsToBeLinked = !!source.destinations?.includes(destination._uid)
        if (destinationIsLinkedToSoucre === destinationNeedsToBeLinked) return
        const updatedDestination = destinationsPatchesMap[destination._uid] || destination
        if (destinationNeedsToBeLinked) {
          destinationsPatchesMap[destination._uid] = {
            _sources: [...(updatedDestination._sources || []), source.sourceId],
          }
        } else {
          destinationsPatchesMap[destination._uid] = {
            _sources: (updatedDestination._sources || []).filter(sourceId => sourceId !== source.sourceId),
          }
        }
      })
    })
    await Promise.all(
      Object.entries(destinationsPatchesMap).map(([destUid, patch]) =>
        flowResult(this._destinationsStore.patch(destUid, patch, { updateConnections: false }))
      )
    )
  }

  private async unlinkDeletedSourcesFromDestinations(_deletedSourcesIds: string | string[]): Promise<void> {
    const deletedSourcesIds = toArrayIfNot(_deletedSourcesIds)
    const destinationPatches: { [destUid: string]: Partial<DestinationData> } = {}
    this._destinationsStore.listIncludeHidden.forEach(destination => {
      const destinationIsLinkedToDeletedSources = intersection(destination._sources, deletedSourcesIds).length
      if (destinationIsLinkedToDeletedSources) {
        destinationPatches[destination._uid] = {
          _sources: without(destination._sources || [], ...deletedSourcesIds),
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
    return this._sources ?? []
  }

  public get hasSources(): boolean {
    return !!this._sources.length
  }

  public get state() {
    return this._state
  }

  public get error() {
    return this._errorMessage
  }

  public injectDestinationsStore(destinationsStore: IDestinationsStore): void {
    this._destinationsStore = destinationsStore
  }

  public get(id: string) {
    return this._sources.find(({ sourceId }) => id === sourceId)
  }

  public *pullSources(showGlobalLoader?: boolean) {
    this.resetError()
    this._state = showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING
    try {
      const sources = yield this.services.storageService.table<SourceData>("sources").getAll()
      this.setSourcesInStore(sources ?? [])
    } catch (error) {
      this.setError(GLOBAL_ERROR, `Failed to fetch sources: ${error.message || error}`)
    } finally {
      this._state = IDLE
    }
  }

  public *add(sourceToAdd: SourceData) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      const addedSource = yield this.services.storageService.table<SourceData>("sources").add(sourceToAdd)
      if (!addedSource) {
        throw new Error(`Sources store failed to add a new source: ${sourceToAdd}`)
      }
      this.addToStore(addedSource)
      yield this.patchDestinationsLinksBySourcesUpdates(addedSource)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }

  public *delete(sourceId: string) {
    this.resetError()
    this._state = BACKGROUND_LOADING

    try {
      yield this.services.storageService.table<SourceData>("sources").delete(sourceId)
      this.deleteFromStore(sourceId)
      yield this.unlinkDeletedSourcesFromDestinations(sourceId)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }

  public *replace(sourceToReplace: SourceData, options: EntityUpdateOptions = EDIT_SOURCES_DEFAULT_OPTIONS) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      yield this.services.storageService.table("sources").replace(sourceToReplace.sourceId, sourceToReplace)
      this.replaceSource(sourceToReplace.sourceId, sourceToReplace)
      if (options.updateConnections) yield this.patchDestinationsLinksBySourcesUpdates(sourceToReplace)
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }

  public *patch(
    id: string,
    patch: Partial<SourceData>,
    options: EntityUpdateOptions = EDIT_SOURCES_DEFAULT_OPTIONS
  ): Generator<Promise<unknown>, void, unknown> {
    this.resetError()
    this._state = BACKGROUND_LOADING
    try {
      if (getObjectDepth(patch) > 2) {
        throw new Error(`Sources recursive patch is not supported`)
      }
      yield this.services.storageService.table<SourceData>("sources").patch(id, patch)
      this.patchInStore(id, patch)
      if (options.updateConnections) yield this.patchDestinationsLinksBySourcesUpdates(this.get(id))
    } catch (error) {
      console.error(error)
    } finally {
      this._state = IDLE
    }
  }
}

export const sourcesStore = new SourcesStore()
