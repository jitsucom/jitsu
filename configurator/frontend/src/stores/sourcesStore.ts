// @Libs
import { makeAutoObservable, flow } from 'mobx';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';

interface ISourcesStore {
  sources: SourceData[];
  state: SourcesStoreState;
  error: string;
  pullSources: (
    showGlobalLoader: boolean
  ) => Generator<Promise<unknown>, void, unknown>;
  addSource: (source: SourceData) => Generator<Promise<unknown>, void, unknown>;
  deleteSource: (
    source: SourceData
  ) => Generator<Promise<unknown>, void, unknown>;
  editSource: (
    newData: SourceData
  ) => Generator<Promise<unknown>, void, unknown>;
}

enum SourceStoreGeneralState {
  'IDLE' = 'IDLE'
}

enum SourcesStoreLoadingState {
  'GLOBAL_LOADING' = 'GLOBAL_LOADING',
  'BACKGROUND_LOADING' = 'BACKGROUND_LOADING'
}

enum SourceStoreErroredState {
  'GLOBAL_ERROR' = 'GLOBAL_ERROR'
}

export const SourcesStoreState = {
  ...SourceStoreGeneralState,
  ...SourcesStoreLoadingState,
  ...SourceStoreErroredState
};

export type SourcesStoreState =
  typeof SourcesStoreState[keyof typeof SourcesStoreState];

const { IDLE, GLOBAL_LOADING, BACKGROUND_LOADING, GLOBAL_ERROR } =
  SourcesStoreState;

const services = ApplicationServices.get();

class SourcesStore implements ISourcesStore {
  private _sources: SourceData[] = [];
  private _state: SourcesStoreState = GLOBAL_LOADING;
  private _errorMessage: string = '';

  constructor() {
    makeAutoObservable(this);
  }

  private setError(state: SourceStoreErroredState, message: string) {
    this._state = state;
    this._errorMessage = message;
  }

  private resetError() {
    this._errorMessage = '';
    const stateIsErrored = Object.values(SourceStoreErroredState).includes(
      this._state as any
    );
    if (stateIsErrored) this._state = IDLE;
  }

  public get sources() {
    return this._sources;
  }

  public get state() {
    return this._state;
  }

  public get error() {
    return this._errorMessage;
  }

  public *pullSources(showGlobalLoader?: boolean) {
    console.log('pulling');
    this.resetError();
    this._state = showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING;
    try {
      const { sources } = yield services.storageService.get(
        'sources',
        services.activeProject.id
      );
      this._sources = sources;
    } catch (error) {
      this.setError(
        GLOBAL_ERROR,
        `Failed to fetch sources: ${error.message || error}`
      );
    } finally {
      this._state = IDLE;
    }
  }

  public *addSource(sourceToAdd: SourceData) {
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const updatedSources = [...this._sources, sourceToAdd];
    try {
      const result = yield services.storageService.save(
        'sources',
        { sources: updatedSources },
        services.activeProject.id
      );
      this._sources = updatedSources;
    } catch (error) {
      throw error;
    } finally {
      this._state = IDLE;
    }
  }

  public *deleteSource(sourceToDelete: SourceData) {
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const updatedSources = this._sources.filter(
      ({ sourceId }) => sourceId !== sourceToDelete.sourceId
    );
    try {
      const result = yield services.storageService.save(
        'sources',
        { sources: updatedSources },
        services.activeProject.id
      );
      this._sources = updatedSources;
    } catch (error) {
      throw error;
    } finally {
      this._state = IDLE;
    }
  }

  public *editSource(sourceToUpdate: SourceData) {
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const updatedSources = this._sources.map((source) => {
      if (source.sourceId !== sourceToUpdate.sourceId) return source;
      return sourceToUpdate;
    });
    try {
      const result = yield services.storageService.save(
        'sources',
        { sources: updatedSources },
        services.activeProject.id
      );
      this._sources = updatedSources;
    } catch (error) {
      throw error;
    } finally {
      this._state = IDLE;
    }
  }
}

export const sourcesStore = new SourcesStore();
