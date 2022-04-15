import ApplicationServices from "./ApplicationServices"
import { BackendApiClient } from "./BackendApiClient"
import { UserDTO } from "./model"
import { merge } from "lodash"
import { sanitize } from "../commons/utils"

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
  abstract getUserInfo(): Promise<UserDTO>

  /**
   * Saves users information required for system (on-boarding status, user projects, etc.)
   * (user id is got from authorization token)
   * @param data User JSON representation
   */
  abstract saveUserInfo(userInfo: Partial<UserDTO>): Promise<void>

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

  getUserInfo(): Promise<UserDTO> {
    return this.backendApi.get(`/users/info`)
  }

  async saveUserInfo(data: Partial<UserDTO>): Promise<void> {
    let current: UserDTO = await this.backendApi.get(`/users/info`)
    let mergedUserInfo = sanitize(merge(current, data), {
      // TODO _email is temporary
      allow: [
        "_emailOptout",
        "_name",
        "_forcePasswordChange",
        "_name",
        "_onboarded",
        "_suggestedInfo",
        "_project",
        "_email",
      ],
    })
    console.log("Saving user info", mergedUserInfo)
    return this.backendApi.post(`/users/info`, mergedUserInfo)
  }
}

type ObjectsApiTypes = "destinations" | "sources" | "api_keys"
