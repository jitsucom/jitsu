import Marshal from "lib/commons/marshalling"
import { BackendApiClient } from "./BackendApiClient"
import { UserDTO } from "./model"
import ApplicationServices from "./ApplicationServices"
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
   * Returns an object by key. If key is not set, user id will be used as key
   */
  abstract get(collectionName: string, key: string): Promise<any>

  /**
   * Returns user info object (user id is got from authorization token)
   */
  abstract getUserInfo(): Promise<UserDTO>

  /**
   * Saves an object by key. If key is not set, user id will be used as key
   */
  abstract save(collectionName: string, data: any, key: string): Promise<void>

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
      return getEntitiesTable<T>(this.backendApi, type, projectId, {
        arrayNodePath: "keys",
        idFieldPath: "uid",
      })
    }
    if (type === "destinations") {
      return getEntitiesTable<T>(this.backendApi, type, projectId, {
        idFieldPath: "_uid",
      })
    }
    if (type === "sources") {
      return getEntitiesTable<T>(this.backendApi, "sources", projectId, {
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
   * Return all entities
   */
  getAll(): Promise<T[]>

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
}

function getEntitiesTable<T = any>(
  api: BackendApiClient,
  collectionName: ObjectsApiTypes,
  collectionId: string,
  dataLayout: {
    //root array node. If not set, should be equal to collectionName
    arrayNodePath?: string
    //Path to collectionId field
    idFieldPath: string
  }
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
    async get(id: string): Promise<T> {
      return await api.get(`/objects/${collectionId}/${collectionName}/${id}`, { version: 2 })
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
    let mergedUserInfo = merge(
      current,
      sanitize(data, {
        allow: ["_emailOptout", "_name", "_forcePasswordChange", "_name", "_onboarded", "_suggestedInfo", "_project"],
      })
    )
    console.log("Saving user info", mergedUserInfo)
    return this.backendApi.post(`/users/info`, mergedUserInfo)
  }

  get(collectionName: string, key: string): Promise<any> {
    return this.backendApi.get(`/configurations/${collectionName}?id=${key}`)
  }

  save(collectionName: string, data: any, key: string): Promise<void> {
    return this.backendApi.post(`/configurations/${collectionName}?id=${key}`, Marshal.toPureJson(data))
  }
}

type ObjectsApiTypes = "destinations" | "sources" | "api_keys"
