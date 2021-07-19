import { randomId } from 'utils/numbers';
import ApplicationServices from 'lib/services/ApplicationServices';

export default class ApiKeyHelper {
  private _services: ApplicationServices

  private _keys: APIKey[];

  private _destinations: DestinationData[];

  constructor(services: ApplicationServices) {
    this._services = services;
  }

  private async fetchKeys(): Promise<APIKey[]> {
    return (await this._services.storageService.get('api_keys', this._services.activeProject.id))['keys'] || [];
  }

  private async fetchDestinations(): Promise<DestinationData[]> {
    const destinations = (await this._services.storageService.get('destinations', this._services.activeProject.id))['destinations'];
    return destinations || [];
  }

  private async pullKeys(): Promise<void> {
    this._keys = await this.fetchKeys();
  }

  private async pullDestinations(): Promise<void> {
    this._destinations = await this.fetchDestinations();
  }

  private async putKeys(keys: APIKey[]): Promise<void> {
    await this._services.storageService.save('api_keys', { keys }, this._services.activeProject.id);
  }

  private async putDestinations(destinations: DestinationData[]): Promise<void> {
    await this._services.storageService.save('destinations', { destinations: destinations }, this._services.activeProject.id);
  }

  private async syncWithBackend() {
    await this.pullKeys();
    await this.pullDestinations();
  }

  public async init() {
    await this.syncWithBackend();
  }

  public async addKey(key: APIKey): Promise<void> {
    const keys = await this.fetchKeys();
    const keyAlreadyExists = keys.findIndex(_key => _key.uid === key.uid) !== -1;
    if (!keyAlreadyExists) await this.putKeys([...keys, key]);
    await this.pullKeys();
  }

  public async addDestination(destination: DestinationData): Promise<void> {
    const destinations = await this.fetchDestinations();
    const destinationAlreadyExists = destinations.findIndex(_destination => _destination._uid === destination?._uid) !== -1;
    if (!destinationAlreadyExists) await this.putDestinations([...destinations, destination]);
    await this.pullDestinations();
  }

  private generateToken(type: string, length?: number) {
    const postfix = `${ApplicationServices.get().activeProject.id}.${randomId(length)}`;
    return type.length > 0 ?
      `${type}.${postfix}` :
      postfix;
  }

  private generateNewAPIKey(): APIKey {
    return {
      uid: this.generateToken('', 6),
      serverAuth: this.generateToken('s2s'),
      jsAuth: this.generateToken('js'),
      origins: []
    };
  }

  public async createNewAPIKey(): Promise<APIKey> {
    const key = this.generateNewAPIKey();
    await this.addKey(key);
    return key;
  }

  public async findFirstLinkedKey(): Promise<APIKey | null> {
    const linkedDestination = this._destinations.find(dest => dest._onlyKeys?.length > 0);
    if (!linkedDestination) return null;

    const linkedKeys = this._keys.filter(_key => linkedDestination._onlyKeys.includes(_key.uid));
    return linkedKeys[0];
  }

  public async findFirstNotLinkedDestination(): Promise<{
    destination: DestinationData;
    keys: APIKey[];
  } | null> {
    const destination = this._destinations.find(dest => dest._onlyKeys?.length === 0);
    if (!destination) return null;

    const keys = this._keys.filter(_key => destination._onlyKeys.includes(_key.uid));
    return { destination, keys };
  }

  get keys(): APIKey[] {
    return this._keys;
  }

  get destinations(): DestinationData[] {
    return this._destinations;
  }

  /**
   * At least one key linked to a destination
   */
  public hasLinks(): boolean {
    if (this._keys.length !== 1 || this._destinations.length !== 1) {
      //so far we support only the simple case one key => one destination
      if (!this._destinations[0]._onlyKeys || this._destinations[0]._onlyKeys.length === 0 ) {
        return false;
      }
    }
    return true;
  }

  public async linkKeyToDestination(key: APIKey, destination: DestinationData): Promise<void> {
    const restDestinations = this._destinations.filter(dest => dest._id !== destination._id);
    destination._onlyKeys = [...destination._onlyKeys, key.uid];
    const allDestinations = [...restDestinations, destination];
    await this.putDestinations(allDestinations);
    await this.syncWithBackend();
  }

  public async link(): Promise<void> {
    if (this._keys.length !== 1 || this._destinations.length !== 1) {
      //Only simple case is supported
      return;
    }

    this._destinations[0]._onlyKeys = [this._keys[0].uid];
    await this.putDestinations(this._destinations);
  }
}