import ApplicationServices from '@service/ApplicationServices';

export default class ApiKeyHelper {
  private _services: ApplicationServices

  private _keys: APIKey[];

  private _destinations: DestinationData[];

  constructor(services: ApplicationServices, preloaded: {keys?: APIKey[], destinations?: DestinationData[]}) {
    this._services = services;
    this._keys = preloaded?.keys;
    this._destinations = preloaded?.destinations;
  }

  public async init() {
    if (!this._keys) {
      this._keys = (await this._services.storageService.get('api_keys', this._services.activeProject.id))['keys'] || []
    }
    if (!this._destinations) {
      this._destinations = (await this._services.storageService.get('destinations', this._services.activeProject.id))['_destinations'] || []
    }
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

  public async link(): Promise<void> {
    if (this._keys.length !== 1 || this._destinations.length !== 1) {
      //Only simple case is supported
      return;
    }

    this._destinations[0]._onlyKeys = [this._keys[0].uid];
    await this._services.storageService.save('destinations', { destinations: this._destinations }, this._services.activeProject.id);
  }
}