import Marshal from "lib/commons/marshalling"
import { BackendApiClient } from "./BackendApiClient"
import { User, UserDTO } from "./model"
import ApplicationServices from "./ApplicationServices"
import { merge } from "lodash-es"
import { sanitize } from "../commons/utils"
import { Project } from "../../generated/conf-openapi"

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
  abstract getUserInfo(): Promise<UserDTO>

  //  * @deprecated use `create`, `add`, `delete`, `patch` instead
  /**
   * Saves an object by key. If key is not set, user id will be used as key
   */
  abstract save(collectionName: string, data: any, key: string): Promise<void>

  /**
   * Saves user info. The data will be merged in into existing user info. Updates on some fields (such as project, etc)
   * will be ignored. See implementation for details
   */
  abstract saveUserInfo(data: Partial<UserDTO>): Promise<void>

  /**
   * Sets project for user. Temporary method. Later, should be replaced with /project/link call
   *
   * Existing project will be rewritten
   *
   */
  abstract setProject(project: Project): Promise<void>

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
      return await this.backendApi.post(`/objects/${collectionId}/${collectionName}`, object, {version: 2})
    },
    async delete(id: string): Promise<void> {
      return await this.backendApi.delete(`/objects/${collectionId}/${collectionName}/${id}`, {version: 2})
    },
    async get(id: string): Promise<T> {
      return await this.backendApi.get(`/objects/${collectionId}/${collectionName}/${id}`, {version: 2})
    },
    async getAll(stripFields?: string[]): Promise<T[]> {
      if (stripFields) throw new Error(`stripFields is not implemented`)
      return await storage.get(collectionName, collectionId)
    },
    async patch<T>(id: string, patch: T): Promise<void> {
      return await this.backendApi.patch(`/objects/${collectionId}/${collectionName}/${id}`, patch, {version: 2})
    },
    async replace<T>(id: string, object: T): Promise<void> {
      return await this.backendApi.put(`/objects/${collectionId}/${collectionName}/${id}`, object, {version: 2})
    },
  }
}

export class HttpServerStorage extends ServerStorage {
  private backendApi: BackendApiClient

  constructor(backendApi: BackendApiClient) {
    super()
    this.backendApi = backendApi
  }

  getUserInfo(): Promise<UserDTO> {
    return this.backendApi.get(`/users/info`)
  }

  async saveUserInfo(data: UserDTO): Promise<void> {
    let current: UserDTO = await this.backendApi.get(`/users/info`)
    let mergedUserInfo = merge(
      current,
      sanitize(data, {
        allow: ["_emailOptout", "_name", "_forcePasswordChange", "_name", "_onboarded", "_suggestedInfo"],
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

  async setProject(project: Project): Promise<void> {
    let current: UserDTO = await this.backendApi.get(`/users/info`)
    current._project = {$type: "Project", _id: project.id, _name: project.name, _planId: project.planId || "free"}
    return this.backendApi.post(`/users/info`, current)
  }
}

type ObjectsApiTypes = "destinations" | "sources" | "api_keys"
