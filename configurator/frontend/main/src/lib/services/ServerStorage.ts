import Marshal from "lib/commons/marshalling"
import ApplicationServices from "./ApplicationServices"
import { BackendApiClient } from "./BackendApiClient"
import { User } from "./model"

/**
 * A generic object storage
 */
export abstract class ServerStorage {
  protected readonly backendApi: BackendApiClient

  constructor(backendApi: BackendApiClient) {
    this.backendApi = backendApi
  }

  /**
   * Returns user info object (user id is got from authorization token)
   */
  abstract getUserInfo(): Promise<User>

  /**
   * Saves users information required for system (on-boarding status, user projects, etc.)
   * (user id is got from authorization token)
   * @param data User JSON representation
   */
  abstract saveUserInfo(data: any): Promise<void>

  /**
   * Returns a table-like structure for managing config. See ConfigurationEntitiesTable
   */
  table<T = any>(type: ObjectsApiTypes): ConfigurationEntitiesTable<T> {
    let projectId = ApplicationServices.get().activeProject.id
    if (type === "api_keys") {
      return getEntitiesTable<T>(this.backendApi, type, projectId)
    }
    if (type === "destinations") {
      return getEntitiesTable<T>(this.backendApi, type, projectId)
    }
    if (type === "sources") {
      return getEntitiesTable<T>(this.backendApi, "sources", projectId)
    }

    throw new Error(`Unknown table type ${type}`)
  }
}

/**
 * Table-like structure for managing server-side config
 */
export interface ConfigurationEntitiesTable<T = any> {
  /**
   * Return all entities
   */
  getAll(): Promise<T[]>

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
}

function getEntitiesTable<T = any>(
  api: BackendApiClient,
  collectionName: ObjectsApiTypes,
  collectionId: string
): ConfigurationEntitiesTable<T> {
  return {
    async add<T>(object: T): Promise<T> {
      return await api.post<T>(`/objects/${collectionId}/${collectionName}`, object, {
        version: 2,
      })
    },
    async delete(id: string): Promise<void> {
      return await api.delete(`/objects/${collectionId}/${collectionName}/${id}`, { version: 2 })
    },
    async getAll(): Promise<T[]> {
      return await api.get(`/objects/${collectionId}/${collectionName}`, { version: 2 })
    },
    async patch<T>(id: string, patch: T): Promise<void> {
      return await api.patch(`/objects/${collectionId}/${collectionName}/${id}`, patch, {
        version: 2,
      })
    },
    async replace<T>(id: string, object: T): Promise<void> {
      return await api.put(`/objects/${collectionId}/${collectionName}/${id}`, object, {
        version: 2,
      })
    },
  }
}

export class HttpServerStorage extends ServerStorage {
  public static readonly USERS_INFO_PATH = "/users/info"

  constructor(backendApi: BackendApiClient) {
    super(backendApi)
  }

  getUserInfo(): Promise<User> {
    return this.backendApi.get(`${HttpServerStorage.USERS_INFO_PATH}`)
  }

  saveUserInfo(data: any): Promise<void> {
    return this.backendApi.post(`${HttpServerStorage.USERS_INFO_PATH}`, Marshal.toPureJson(data))
  }
}

type ObjectsApiTypes = "destinations" | "sources" | "api_keys"
