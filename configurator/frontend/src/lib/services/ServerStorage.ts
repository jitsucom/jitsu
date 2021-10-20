import Marshal from "lib/commons/marshalling"
import { BackendApiClient } from "./BackendApiClient"
import { User } from "./model"

/**
 * A generic object storage
 */
export interface ServerStorage {
  /**
   * Returns an object by key. If key is not set, user id will be used as key
   */
  get(collectionName: string, key: string): Promise<any>

  /**
   * Returns user info object (user id is got from authorization token)
   */
  getUserInfo(): Promise<User>

  /**
   * Saves an object by key. If key is not set, user id will be used as key
   */
  save(collectionName: string, data: any, key: string): Promise<void>

  /**
   * Saves users information required for system (on-boarding status, user projects, etc.)
   * (user id is got from authorization token)
   * @param data User JSON representation
   */
  saveUserInfo(data: any): Promise<void>
}

/**
 * This is a layer on top of ServerStorage. It works with individual objects within collections. It assumes that
 * collection has a following structure:
 *
 * {
 *   collectionName: [
 *     collectionObject1, collectionObject2
 *   ]
 *
 * }
 */
export interface EntitiesCollection<T = any> {
  /**
   * Return all entities. stripFields - fields that should be removed from all entities
   */
  getAll(stripFields?: string[]): Promise<T[]>

  /**
   * @param id get entity by id
   */
  get(id: string): Promise<T>

  /**
   * Patches the entity by id (merges current version with object)
   */
  patch(id: string, object: T): Promise<void>

  /**
   * Replaces entity by id
   */
  replace(id: string, object: T): Promise<void>
}

export function getEntitiesCollection<T = any>(
  storage: ServerStorage,
  collectionName: string,
  collectionId: string,
  dataLayout: {
    //root array node. If not set, should be equal to collectionName
    arrayNodePath?: string
    //Path to collectionId field
    idFieldPath: string
  }
): EntitiesCollection<T> {
  const arrayNode = dataLayout.arrayNodePath ?? collectionName
  /**
   * Warning: this implementation is not complete. It has a certain caveats and serves
   * as a temporary solution unless we have a logic implemented on the server. Caveats:
   *   - Patch is not recursive
   *   - arrayNode and idFieldPath are not treated as json paths (e.g. `a` will work, but `a.b` won't)
   */
  return {
    get(id: string): Promise<T> {
      throw new Error("Not implemented")
    },
    getAll(stripFields: string[] | undefined): Promise<T[]> {
      throw new Error("Not implemented")
    },
    async patch<T>(id: string, patch: T): Promise<void> {
      let collection = await storage.get(collectionName, collectionId)
      if (!collection) {
        throw new Error(`Can't find collection with id=${collectionId} @ ${collectionName}`)
      }
      let objects = collection[arrayNode]
      if (!objects) {
        throw new Error(
          `Can't find ${arrayNode} in ${collectionName} object collection. Available: ${Object.keys(collection)}`
        )
      }
      let currentObject = objects.find(obj => obj[dataLayout.idFieldPath] === id)
      if (!currentObject) {
        throw new Error(
          `Can't find object where ${dataLayout.idFieldPath} === ${id} in collection ${collectionName}(path=${arrayNode})`
        )
      }

      for (const [key, val] of Object.entries(patch)) {
        currentObject[key] = val
      }
      await storage.save(collectionName, collection, collectionId)
    },
    replace<T>(id: string, object: T): Promise<void> {
      throw new Error("Not implemented")
    },
  }
}

export class HttpServerStorage implements ServerStorage {
  public static readonly USERS_INFO_PATH = "/users/info"
  private backendApi: BackendApiClient

  constructor(backendApi: BackendApiClient) {
    this.backendApi = backendApi
  }

  getUserInfo(): Promise<User> {
    return this.backendApi.get(`${HttpServerStorage.USERS_INFO_PATH}`)
  }

  saveUserInfo(data: any): Promise<void> {
    return this.backendApi.post(`${HttpServerStorage.USERS_INFO_PATH}`, Marshal.toPureJson(data))
  }

  get(collectionName: string, key: string): Promise<any> {
    return this.backendApi.get(`/configurations/${collectionName}?id=${key}`)
  }

  save(collectionName: string, data: any, key: string): Promise<void> {
    return this.backendApi.post(`/configurations/${collectionName}?id=${key}`, Marshal.toPureJson(data))
  }
}
