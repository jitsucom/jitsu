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

  //  * @deprecated use `create`, `add`, `delete`, `patch` instead
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
   * Adds an object by collectionId and collectionName
   */
  abstract add<T>(collectionId: string, collectionName: ObjectsApiTypes, data: any): Promise<T>

  /**
   * Deletes an object by collectionId, collectionName and object ID
   */
  abstract delete(collectionId: string, collectionName: string, id: string): Promise<void>

  /**
   * Replaces an object by collectionId, collectionName and object ID
   */
  abstract put<T>(collectionId: string, collectionName: string, id: string, data: any): Promise<T>

  /**
   * Patches an object by collectionId, collectionName and object ID
   */
  abstract patch<T>(collectionId: string, collectionName: string, id: string, patch: any): Promise<T>

  /**
   * Returns a table-like structure for managing config. See ConfigurationEntitiesTable
   */
  table<T = any>(type: ObjectsApiTypes): ConfigurationEntitiesTable<T> {
    let projectId = ApplicationServices.get().activeProject.id
    if (type === "api_keys") {
      return getEntitiesTable<T>(this, type, projectId, {
        arrayNodePath: "keys",
        idFieldPath: "uid",
      })
    }
    if (type === "destinations") {
      return getEntitiesTable<T>(this, type, projectId, {
        idFieldPath: "_uid",
      })
    }
    if (type === "sources") {
      return getEntitiesTable<T>(this, "sources", projectId, {
        idFieldPath: "sourceId",
      })
    }

    throw new Error(`Unknown table type ${type}`)
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
  add(object: T): Promise<T>

  /**
   * Removes entity by id
   */
  delete(id: string): Promise<void>

  /**
   * Upserts the object. Creates a new one if the object with id doesn't exist or replaces an existing one
   */
  upsert(id: string, object: T): Promise<void>
}

function getEntitiesTable<T = any>(
  storage: ServerStorage,
  collectionName: ObjectsApiTypes,
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
    async upsert<T>(id: string, object: T): Promise<never> {
      const collection = await getCollection()
      const objects = getArrayNode(collection)
      const objIndex = objects.findIndex(obj => obj[dataLayout.idFieldPath] === id)
      if (objIndex < 0) {
        this.table(collectionName).add(object)
      } else {
        this.table(collectionName).replace(id, object)
      }
      throw new Error("Not implemented")
    },
    async add<T>(object: T): Promise<T> {
      return await storage.add(collectionId, collectionName, object)
    },
    async delete(id: string): Promise<void> {
      return await storage.delete(collectionId, collectionName, id)
    },
    async get(id: string): Promise<T> {
      return await storage.get(collectionId, id)
    },
    async getAll(stripFields?: string[]): Promise<T[]> {
      if (stripFields) throw new Error(`stripFields is not implemented`)
      return await storage.get(collectionName, collectionId)
    },
    async patch<T>(id: string, patch: T): Promise<void> {
      return await storage.patch(collectionId, collectionName, id, patch)
    },
    async replace<T>(id: string, object: T): Promise<void> {
      return await storage.put(collectionId, collectionName, id, object)
    },
  }
}

export class HttpServerStorage extends ServerStorage {
  public static readonly USERS_INFO_PATH = "/users/info"
  private readonly backendApi: BackendApiClient

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

  add<T>(collectionId: string, collectionName: string, data: any): Promise<T> {
    return this.backendApi.post<T>(`/objects/${collectionId}/${collectionName}`, Marshal.toPureJson(data), {
      version: 2,
    })
  }

  delete(collectionId: string, collectionName: string, id: string): Promise<void> {
    return this.backendApi.delete(`/objects/${collectionId}/${collectionName}/${id}`, { version: 2 })
  }

  put<T>(collectionId: string, collectionName: string, id: string, data: any): Promise<T> {
    return this.backendApi.put(`/objects/${collectionId}/${collectionName}/${id}`, Marshal.toPureJson(data), {
      version: 2,
    })
  }

  patch<T>(collectionId: string, collectionName: string, id: string, patch: any): Promise<T> {
    return this.backendApi.patch(`/objects/${collectionId}/${collectionName}/${id}`, Marshal.toPureJson(patch), {
      version: 2,
    })
  }
}

type ObjectsApiTypes = "destinations" | "sources" | "api_keys"
