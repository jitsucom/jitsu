import Marshal from 'lib/commons/marshalling';
import { BackendApiClient } from './BackendApiClient';
import { User } from './model';

/**
 * A generic object storage
 */
export interface ServerStorage {
  /**
   * Returns an object by key. If key is not set, user id will be used as key
   */
  get(collectionName: string, key: string): Promise<any>;

  /**
   * Returns user info object (user id is got from authorization token)
   */
  getUserInfo(): Promise<User>;

  /**
   * Saves an object by key. If key is not set, user id will be used as key
   */
  // ToDo: key is required parameter according to save-method signature, ask Vladimir about that
  save(collectionName: string, data: any, key: string): Promise<void>;

  /**
   * Saves users information required for system (on-boarding status, user projects, etc.)
   * (user id is got from authorization token)
   * @param data User JSON representation
   */
  saveUserInfo(data: any): Promise<void>;
}

export class HttpServerStorage implements ServerStorage {
  public static readonly USERS_INFO_PATH = '/users/info';
  private backendApi: BackendApiClient;

  constructor(backendApi: BackendApiClient) {
    this.backendApi = backendApi;
  }

  getUserInfo(): Promise<User> {
    return this.backendApi.get(`${HttpServerStorage.USERS_INFO_PATH}`);
  }

  saveUserInfo(data: any): Promise<void> {
    return this.backendApi.post(
      `${HttpServerStorage.USERS_INFO_PATH}`,
      Marshal.toPureJson(data)
    );
  }

  get(collectionName: string, key: string): Promise<any> {
    return this.backendApi.get(`/configurations/${collectionName}?id=${key}`);
  }

  save(collectionName: string, data: any, key: string): Promise<void> {
    return this.backendApi.post(
      `/configurations/${collectionName}?id=${key}`,
      Marshal.toPureJson(data)
    );
  }
}
