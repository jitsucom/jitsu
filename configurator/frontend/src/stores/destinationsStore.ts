// @Libs
import { makeAutoObservable, flow } from 'mobx';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices';

interface IDestinationsStore {
  destinations: DestinationData[];
  state: DestinationsStoreState;
  error: string;
  pullDestinations: (
    showGlobalLoader: boolean
  ) => Generator<Promise<unknown>, void, unknown>;
  addDestination: (
    destination: DestinationData
  ) => Generator<Promise<unknown>, void, unknown>;
  deleteDestination: (
    destination: DestinationData
  ) => Generator<Promise<unknown>, void, unknown>;
  editDestination: (
    newData: DestinationData
  ) => Generator<Promise<unknown>, void, unknown>;
}

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

  public get destinations() {
    return this._destinations;
  }

  public get state() {
    return this._state;
  }

  public get error() {
    return this._errorMessage;
  }

  public *pullDestinations(showGlobalLoader?: boolean) {
    console.log('pulling');
    this.resetError();
    this._state = showGlobalLoader ? GLOBAL_LOADING : BACKGROUND_LOADING;
    try {
      const { destinations } = yield services.storageService.get(
        'destinations',
        services.activeProject.id
      );
      this._destinations = destinations;
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
    } catch (error) {
      throw error;
    } finally {
      this._state = IDLE;
    }
  }

  public *editDestination(destinationToUpdate: DestinationData) {
    this.resetError();
    this._state = BACKGROUND_LOADING;
    const updatedDestinations = this._destinations.map((destination) => {
      if (destination._uid !== destinationToUpdate._uid) return destination;
      return destinationToUpdate;
    });
    try {
      const result = yield services.storageService.save(
        'destinations',
        { destinations: updatedDestinations },
        services.activeProject.id
      );
      this._destinations = updatedDestinations;
    } catch (error) {
      throw error;
    } finally {
      this._state = IDLE;
    }
  }
}

export const destinationsStore = new DestinationsStore();
