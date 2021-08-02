// @Libs
import { flowResult, makeAutoObservable } from 'mobx';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Utils
import { intersection, union, without } from 'lodash';
import { toArrayIfNot } from 'utils/arrays';
import { ISourcesStore, sourcesStore } from './sources';
import { apiKeysStore, IApiKeysStore, UserApiKey } from './apiKeys';

export interface IDestinationsStore {
  destinations: DestinationData[];
  hasDestinations: boolean;
  state: DestinationsStoreState;
  error: string;
  injectSourcesStore: (sourcesStore: ISourcesStore) => void;
  getDestinationById: (id: string) => DestinationData | null;
  getDestinationByUid: (uid: string) => DestinationData | null;
  pullDestinations: (
    showGlobalLoader: boolean
  ) => Generator<Promise<unknown>, void, unknown>;
  addDestination: (
    destination: DestinationData
  ) => Generator<Promise<unknown>, void, unknown>;
  deleteDestination: (
    destination: DestinationData
  ) => Generator<Promise<unknown>, void, unknown>;
  editDestinations: (
    destinationsToUpdate: DestinationData | DestinationData[],
    options?: EditDestinationsOptions
  ) => Generator<Promise<unknown>, void, unknown>;
  createFreeDatabase: () => Generator<Promise<unknown>, void, unknown>;
  linkApiKeysToDestinations: (
    apiKeys: UserApiKey | UserApiKey[],
    destinations: DestinationData | DestinationData[]
  ) => Generator<Promise<unknown>, void, unknown>;
}

type EditDestinationsOptions = {
  updateSources?: boolean;
};

const EDIT_DESTINATIONS_DEFAULT_OPTIONS: EditDestinationsOptions = {
  updateSources: true
};

enum DestinationStoreGeneralState {
  'IDLE' = 'IDLE'
}

enum DestinationsStoreLoadingState {
  'GLOBAL_LOADING' = 'GLOBAL_LOADING',
  'BACKGROUND_LOADING' = 'BACKGROUND_LOADING'
}

enum DestinationStoreErroredState {
  'GLOBAL_ERROR' = 'GLOBAL_ERROR'
}

export const DestinationsStoreState = {
  ...DestinationStoreGeneralState,
  ...DestinationsStoreLoadingState,
  ...DestinationStoreErroredState
};

export type DestinationsStoreState =
  typeof DestinationsStoreState[keyof typeof DestinationsStoreState];

const { IDLE, GLOBAL_LOADING, BACKGROUND_LOADING, GLOBAL_ERROR } =
  DestinationsStoreState;

const services = ApplicationServices.get();
class DestinationsStore implements IDestinationsStore {
  private _destinations: DestinationData[] = [];
  private _state: DestinationsStoreState = GLOBAL_LOADING;
  private _errorMessage: string = '';
  private _sourcesStore: ISourcesStore | undefined;
  private _apiKeysStore: IApiKeysStore = apiKeysStore;

  constructor() {
    makeAutoObservable(this);
  }

  private setError(state: DestinationStoreErroredState, message: string) {
    this._state = state;
    this._errorMessage = message;
  }

  private resetError() {
    this._errorMessage = '';
    const stateIsErrored = Object.values(DestinationStoreErroredState).includes(
      this._state as any
    );
    if (stateIsErrored) this._state = IDLE;
  }

  private updateSourcesLinksByDestinationsUpdates(
    _updatedDestinations: DestinationData | DestinationData[]
  ) {
    const updatedDestinations = toArrayIfNot(_updatedDestinations);
    const updatedSourcesMap: { [key: string]: SourceData } = {};
    updatedDestinations.forEach((destination) => {
      this._sourcesStore.sources.forEach((source) => {
        const sourceLinkedToDestination = !!source.destinations?.includes(
          destination._uid
        );
        const sourceNeedsToBeLinked = !!destination._sources?.includes(
          source.sourceId
        );
        if (sourceLinkedToDestination === sourceNeedsToBeLinked) return;

        const updatedSource = updatedSourcesMap[source.sourceId] || source;
        if (sourceNeedsToBeLinked) {
          updatedSourcesMap[source.sourceId] = {
            ...updatedSource,
            destinations: [
              ...(updatedSource.destinations || []),
              destination._uid
            ]
          };
        } else {
          updatedSourcesMap[source.sourceId] = {
            ...updatedSource,
            destinations: (updatedSource.destinations || []).filter(
              (destinationUid) => destinationUid !== destination._uid
            )
          };
        }
      });
    });
    const updatedSourcesList = Object.values(updatedSourcesMap);
    if (updatedSourcesList.length)
      this._sourcesStore.editSources(updatedSourcesList, {
        updateDestinations: false
      });
  }

  private unlinkDeletedDestinationsFromSources(
    _deletedDestinations: DestinationData | DestinationData[]
  ) {
    const destinationsToDelete = toArrayIfNot(_deletedDestinations);
    const destinationsToDeleteUids = destinationsToDelete.map(
      ({ _uid }) => _uid
    );
    const updatedSourcesAccumulator: SourceData[] = [];
    const updatedSources = sourcesStore.sources.reduce(
      (updatedSources, source) => {
        if (!intersection(source.destinations, destinationsToDeleteUids).length)
          return updatedSources;
        const updated: SourceData = {
          ...source,
          destinations: without(
            source.destinations || [],
            ...destinationsToDeleteUids
          )
        };
        return [...updatedSources, updated];
      },
      updatedSourcesAccumulator
    );
    if (updatedSources.length)
      this._sourcesStore.editSources(updatedSources, {
        updateDestinations: false
      });
  }

  public injectSourcesStore(sourcesStore: ISourcesStore): void {
    this._sourcesStore = sourcesStore;
  }

  public get destinations() {
    return this._destinations;
  }

  public get hasDestinations(): boolean {
    return !!this._destinations.length;
  }

  public getDestinationById(id: string): DestinationData | null {
    return this.destinations.find(({ _id }) => _id === id);
  }

  public getDestinationByUid(uid: string): DestinationData | null {
    return this.destinations.find(({ _uid }) => _uid === uid);
  }

  public get state() {
    return this._state;
  }

  public get error() {
    return this._errorMessage;
  }

  public *pullDestinations(showGlobalLoader?: boolean) {
    this.resetError();
    this._state = showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING;
    try {
      const { destinations } = yield services.storageService.get(
        'destinations',
        services.activeProject.id
      );
      this._destinations = destinations || [];
    } catch (error) {
      this.setError(
        GLOBAL_ERROR,
        `Failed to fetch destinations: ${error.message || error}`
      );
    } finally {
      this._state = IDLE;
    }
  }

  public *addDestination(destinationToAdd: DestinationData) {
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const updatedDestinations = [...this._destinations, destinationToAdd];
    try {
      const result = yield services.storageService.save(
        'destinations',
        { destinations: updatedDestinations },
        services.activeProject.id
      );
      this._destinations = updatedDestinations;
      this.updateSourcesLinksByDestinationsUpdates(destinationToAdd);
    } catch (error) {
      throw error;
    } finally {
      this._state = IDLE;
    }
  }

  public *deleteDestination(destinationToDelete: DestinationData) {
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const updatedDestinations = this._destinations.filter(
      ({ _uid }) => _uid !== destinationToDelete._uid
    );
    try {
      const result = yield services.storageService.save(
        'destinations',
        { destinations: updatedDestinations },
        services.activeProject.id
      );
      this._destinations = updatedDestinations;
      this.unlinkDeletedDestinationsFromSources(destinationToDelete);
    } finally {
      this._state = IDLE;
    }
  }

  public *editDestinations(
    _destinationsToUpdate: DestinationData | DestinationData[],
    options = EDIT_DESTINATIONS_DEFAULT_OPTIONS
  ) {
    const destinationsToUpdate = toArrayIfNot(_destinationsToUpdate);
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const updatedDestinations = this._destinations.map((destination) => {
      const destinationToReplace = destinationsToUpdate.find(
        ({ _uid }) => _uid === destination._uid
      );
      if (!destinationToReplace) return destination;
      return destinationToReplace;
    });
    try {
      yield services.storageService.save(
        'destinations',
        { destinations: updatedDestinations },
        services.activeProject.id
      );
      this._destinations = updatedDestinations;
      if (options.updateSources)
        this.updateSourcesLinksByDestinationsUpdates(_destinationsToUpdate);
    } finally {
      this._state = IDLE;
    }
  }

  public *createFreeDatabase() {
    const { destinations } =
      (yield services.initializeDefaultDestination()) as {
        destinations: DestinationData[];
      };
    const freeDatabaseDestination = destinations[0];
    yield flowResult(this._apiKeysStore.generateAddInitialApiKeyIfNeeded());
    const linkedFreeDatabaseDestination: DestinationData = {
      ...freeDatabaseDestination,
      _onlyKeys: [this._apiKeysStore.apiKeys[0].uid]
    };
    yield flowResult(this.addDestination(linkedFreeDatabaseDestination));
  }

  public *linkApiKeysToDestinations(
    _apiKeys: UserApiKey | UserApiKey[],
    _destinations: DestinationData | DestinationData[]
  ) {
    const apiKeysUids = toArrayIfNot(_apiKeys).map((key) => key.uid);
    const destinations = toArrayIfNot(_destinations);

    const updatedDestinations: DestinationData[] = destinations.reduce<
      DestinationData[]
    >((updatedDestinations, destination) => {
      const updated: DestinationData = {
        ...destination,
        _onlyKeys: union(destination._onlyKeys, apiKeysUids)
      };
      return [...updatedDestinations, updated];
    }, []);

    yield flowResult(this.editDestinations(updatedDestinations));
  }
}

export const destinationsStore = new DestinationsStore();
