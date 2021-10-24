import Marshal from "lib/commons/marshalling"
import { BackendApiClient } from "./BackendApiClient"
import { User } from "./model"
import ApplicationServices from "./ApplicationServices"

/**
 * A generic object storage
 */
export abstract class ServerStorage {
  /**
   * Returns an object by key. If key is not set, user id will be used as key
   */
  abstract get(collectionName: string, key: string): Promise<any>

  /**
   * Returns user info object (user id is got from authorization token)
   */
  abstract getUserInfo(): Promise<User>

  /**
   * Saves an object by key. If key is not set, user id will be used as key
   */
  abstract save(collectionName: string, data: any, key: string): Promise<void>

  /**
   * Saves users information required for system (on-boarding status, user projects, etc.)
   * (user id is got from authorization token)
   * @param data User JSON representation
   */
  abstract saveUserInfo(data: any): Promise<void>

  /**
   * Returns a table-like structure for managing config. See ConfigurationEntitiesTable
   */
  table<T = any>(type: 'api_keys' | 'destinations' | 'sources'): ConfigurationEntitiesTable<T> {
    let projectId = ApplicationServices.get().activeProject.id
    if (type === "api_keys") {
      return getEntitiesTable<T>(this, type, projectId, {
        arrayNodePath: "keys",
        idFieldPath: "uid",
      })
    } if (type === 'destinations') {
      return getEntitiesTable<T>(this, type, projectId, {
        idFieldPath: "_uid",
      });
    } else if (type === 'sources') {
      return getEntitiesTable<T>(this, "sources", projectId, {
        idFieldPath: "sourceId",
      })
    } else {
      throw new Error(`Unknown table type ${type}`)
    }
  }
}

/**
 * Table-like structure for managing server-side config
 */
export interface ConfigurationEntitiesTable<T = any> {
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
  patch(id: string, object: Partial<T>): Promise<void>

  /**
   * Replaces entity by id
   */
  replace(id: string, object: T): Promise<void>

  /**
   * Adds an object to collection
   */
  add(object: T): Promise<void>

  /**
   * Removes entity by id
   */
  remove(id: string): Promise<void>
}

function getEntitiesTable<T = any>(
  storage: ServerStorage,
  collectionName: string,
  collectionId: string,
  dataLayout: {
    //root array node. If not set, should be equal to collectionName
    arrayNodePath?: string
    //Path to collectionId field
    idFieldPath: string
  }
): ConfigurationEntitiesTable<T> {
  const arrayNode = dataLayout.arrayNodePath ?? collectionName

  async function getCollection() {
    let collection = await storage.get(collectionName, collectionId)
    if (!collection) {
      throw new Error(`Can't find collection with id=${collectionId} @ ${collectionName}`)
    }
    return collection
  }

  const getArrayNode = collection => {
    let objects = collection[arrayNode]
    if (!objects) {
      throw new Error(
        `Can't find ${arrayNode} in ${collectionName} object collection. Available: ${Object.keys(collection)}`
      )
    }
    return objects
  }

  /**
   * Warning: this implementation is not complete. It has a certain caveats and serves
   * as a temporary solution unless we have a logic implemented on the server. Caveats:
   *   - Patch is not recursive
   *   - arrayNode and idFieldPath are not treated as json paths (e.g. `a` will work, but `a.b` won't)
   */
  return {
    async add<T>(object: T): Promise<void> {
      let collection = await getCollection()
      let objects = getArrayNode(collection) as T[]
      objects.push(object)
      await storage.save(collectionName, collection, collectionId)
    },
    async remove(id: string): Promise<void> {
      let collection = await getCollection()
      let objects = getArrayNode(collection) as T[]
      collection[arrayNode] = objects.filter(obj => obj[dataLayout.idFieldPath] !== id)
      await storage.save(collectionName, collection, collectionId)
    },
    get(id: string): Promise<T> {
      throw new Error("Not implemented")
    },
    getAll(stripFields: string[] | undefined): Promise<T[]> {
      throw new Error("Not implemented")
    },
    async patch<T>(id: string, patch: T): Promise<void> {
      let collection = await getCollection()
      let objects = getArrayNode(collection)
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

export class HttpServerStorage extends ServerStorage {
  public static readonly USERS_INFO_PATH = "/users/info"
  private backendApi: BackendApiClient

  constructor(backendApi: BackendApiClient) {
    super()
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
