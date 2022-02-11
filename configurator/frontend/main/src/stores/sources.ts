// @Libs
import { makeAutoObservable } from "mobx"
// @Store
import { IDestinationsStore } from "./destinations"
// @Services
import ApplicationServices, { IApplicationServices } from "lib/services/ApplicationServices"
// @Utils
import { intersection, without } from "lodash"
import { toArrayIfNot } from "utils/arrays"

export interface ISourcesStore {
  sources: SourceData[]
  hasSources: boolean
  state: SourcesStoreState
  error: string
  getSourceById(id: string): SourceData
  pullSources: (showGlobalLoader: boolean) => Generator<Promise<unknown>, void, unknown>
  addSource: (source: SourceData) => Generator<Promise<unknown>, void, unknown>
  deleteSource: (source: SourceData) => Generator<Promise<unknown>, void, unknown>
  editSources: (
    newData: SourceData | SourceData[],
    options?: EditSourcesOptions
  ) => Generator<Promise<unknown>, void, unknown>
}

type EditSourcesOptions = {
  updateDestinations?: boolean
}

const EDIT_SOURCES_DEFAULT_OPTIONS = {
  updateDestinations: true,
} as const

enum SourceStoreGeneralState {
  "IDLE" = "IDLE",
}

enum SourcesStoreLoadingState {
  "GLOBAL_LOADING" = "GLOBAL_LOADING",
  "BACKGROUND_LOADING" = "BACKGROUND_LOADING",
}

enum SourceStoreErroredState {
  "GLOBAL_ERROR" = "GLOBAL_ERROR",
}

export const SourcesStoreState = {
  ...SourceStoreGeneralState,
  ...SourcesStoreLoadingState,
  ...SourceStoreErroredState,
}

export type SourcesStoreState = typeof SourcesStoreState[keyof typeof SourcesStoreState]

const { IDLE, GLOBAL_LOADING, BACKGROUND_LOADING, GLOBAL_ERROR } = SourcesStoreState

class SourcesStore implements ISourcesStore {
  private _sources: SourceData[] = []
  private _state: SourcesStoreState = GLOBAL_LOADING
  private _errorMessage: string = ""
  private _destinatinonsStore: IDestinationsStore | undefined
  private services: IApplicationServices = ApplicationServices.get()

  constructor() {
    makeAutoObservable(this)
  }

  private setError(state: SourceStoreErroredState, message: string) {
    this._state = state
    this._errorMessage = message
  }

  private resetError() {
    this._errorMessage = ""
    const stateIsErrored = Object.values(SourceStoreErroredState).includes(this._state as any)
    if (stateIsErrored) this._state = IDLE
  }

  private updateDestinationsLinksBySourcesUpdates(_updatedSources: SourceData | SourceData[]): void {
    const updatedSources: SourceData[] = toArrayIfNot(_updatedSources)
    const updatedDestinationsMap: { [key: string]: DestinationData } = {}
    updatedSources.forEach(source => {
      this._destinatinonsStore.destinations.forEach(destination => {
        const destinationIsLinkedToSoucre = !!destination._sources?.includes(source.sourceId)
        const destinationNeedsToBeLinked = !!source.destinations?.includes(destination._uid)
        if (destinationIsLinkedToSoucre === destinationNeedsToBeLinked) return

        const updatedDestination = updatedDestinationsMap[destination._uid] || destination
        if (destinationNeedsToBeLinked) {
          updatedDestinationsMap[destination._uid] = {
            ...updatedDestination,
            _sources: [...(updatedDestination._sources || []), source.sourceId],
          }
        } else {
          updatedDestinationsMap[destination._uid] = {
            ...updatedDestination,
            _sources: (updatedDestination._sources || []).filter(sourceId => sourceId !== source.sourceId),
          }
        }
      })
    })
    const updatedDestinationsList = Object.values(updatedDestinationsMap)
    if (updatedDestinationsList.length)
      this._destinatinonsStore.editDestinations(updatedDestinationsList, {
        updateSources: false,
      })
  }

  private unlinkDeletedSourcesFromDestinations(_deletedSources: SourceData | SourceData[]) {
    const deletedSources = toArrayIfNot(_deletedSources)
    const deletedSourcesIds = deletedSources.map(({ sourceId }) => sourceId)
    const updatedDestinationsInitialAccumulator: DestinationData[] = []
    const updatedDestinations = this._destinatinonsStore.destinations.reduce((updatedDestinations, destination) => {
      if (!intersection(destination._sources, deletedSourcesIds).length) return updatedDestinations
      const updated: DestinationData = {
        ...destination,
        _sources: without(destination._sources || [], ...deletedSourcesIds),
      }
      return [...updatedDestinations, updated]
    }, updatedDestinationsInitialAccumulator)
    this._destinatinonsStore.editDestinations(updatedDestinations, {
      updateSources: false,
    })
  }

  public get sources() {
    return this._sources
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
    this._destinatinonsStore = destinationsStore
  }

  public getSourceById(id: string) {
    return this._sources.find(({ sourceId }) => id === sourceId)
  }

  public *pullSources(showGlobalLoader?: boolean) {
    this.resetError()
    this._state = showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING
    try {
      const { sources } = yield this.services.storageService.get("sources", this.services.activeProject.id)
      this._sources = sources || []
    } catch (error) {
      this.setError(GLOBAL_ERROR, `Failed to fetch sources: ${error.message || error}`)
    } finally {
      this._state = IDLE
    }
  }

  public *addSource(sourceToAdd: SourceData) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    const updatedSources = [...this._sources, sourceToAdd]
    try {
      const result = yield this.services.storageService.save(
        "sources",
        { sources: updatedSources },
        this.services.activeProject.id
      )
      this._sources = updatedSources
      this.updateDestinationsLinksBySourcesUpdates(sourceToAdd)
    } catch (error) {
      throw error
    } finally {
      this._state = IDLE
    }
  }

  public *deleteSource(sourceToDelete: SourceData) {
    this.resetError()
    this._state = BACKGROUND_LOADING
    const updatedSources = this._sources.filter(({ sourceId }) => sourceId !== sourceToDelete.sourceId)
    try {
      const result = yield this.services.storageService.save(
        "sources",
        { sources: updatedSources },
        this.services.activeProject.id
      )
      this._sources = updatedSources
      this.unlinkDeletedSourcesFromDestinations(sourceToDelete)
    } catch (error) {
      throw error
    } finally {
      this._state = IDLE
    }
  }

  public *editSources(_sourcesToUpdate: SourceData | SourceData[], options = EDIT_SOURCES_DEFAULT_OPTIONS) {
    const sourcesToUpdate: SourceData[] = toArrayIfNot(_sourcesToUpdate)
    this.resetError()
    this._state = BACKGROUND_LOADING
    const updatedSources = this._sources.map(source => {
      const updateCandidate = sourcesToUpdate.find(updateCandidate => updateCandidate.sourceId === source.sourceId)
      return updateCandidate || source
    })
    try {
      yield this.services.storageService.save("sources", { sources: updatedSources }, this.services.activeProject.id)
      this._sources = updatedSources
      if (options.updateDestinations) this.updateDestinationsLinksBySourcesUpdates(sourcesToUpdate)
    } catch (error) {
      throw error
    } finally {
      this._state = IDLE
    }
  }
}

export const sourcesStore = new SourcesStore()
