/**
 * Class for working with projects and users
 */
import { Project, UserBasicInfo } from "../../generated/conf-openapi"
import { UserService } from "./UserService"
import { BackendApiClient } from "./BackendApiClient"
import { assertHasAllProperties, assertIsArray, assertIsObject } from "utils/typeCheck"
import { assert } from "../../utils/typeCheck"
import { withQueryParams } from "utils/queryParams"

export interface ProjectService {
  /**
   * Creates project and links it to an existing user
   * @param projectName
   */
  createProject(projectName: string): Promise<Project>

  /**
   * Get all projects available for current user
   */
  getAvailableProjects(): Promise<Project[]>

  /**
   * Patches the project with provided data. Project ID field is required.
   */
  updateProject(projectId: string, patch: Partial<Project>): Promise<void>

  /**
   * Get user
   * @param projectId
   */
  getProjectUsers(projectId: string): Promise<UserBasicInfo[]>

  /**
   * Links user with given email to project
   * @return 'invitation_sent' if user non existing and invitation to create account has been sent,
   * or 'user_linked' otherwise
   */
  linkUserToProject(
    projectId: string,
    link: { userId: string; userEmail?: never } | { userId?: never; userEmail: string }
  ): Promise<"invitation_sent" | "user_linked">

  /**
   * Unlinks user with given ID from project
   * @param projectId
   * @param userId
   */
  unlinkFromProject(userId: string, projectId: string): Promise<void>
}

export function createProjectService_v1(userService: UserService, backend: BackendApiClient): ProjectService {
  return {
    async getProjectUsers(projectId: string): Promise<UserBasicInfo[]> {
      const response = await backend.get<unknown>(`/project/${projectId}/users`, { version: 2 })
      assertIsArray(response, "Assertion error in getProjectUsers: response is not an array")
      return response.map((value, index) => {
        assertIsUserBasicInfo(value, `Assertion error in getProjectUsers: element with index ${index} is not a valid UserBasicInfo object`)
        return value
      })
    },

    async linkUserToProject(projectId, link): Promise<"invitation_sent" | "user_linked"> {
      const response = await backend.post<unknown>(`/project/${projectId}/link`, link, { version: 2 })
      assertIsObject(response, `Assertion error in linkUserToProject: response is not an object`)
      assert(
        response.status === "existing" || response.status === "created",
        `Assertion error in linkUserToProject: response.status can only be "existing" or "created" but received ${response.status}`
      )
      switch (response.status) {
        case "created":
          return "user_linked"
        case "existing":
          return "invitation_sent"
      }
    },

    async unlinkFromProject(userId: string, projectId: string): Promise<void> {
      await backend.get<unknown>(withQueryParams(`/project/${projectId}/link`, { userId }), { version: 2 })
      return
    },

    async createProject(name: string): Promise<Project> {
      const response = await backend.post<unknown>("/projects", { name }, { version: 2 })
      assertIsProject(response, "Assertion error in createProject: value returned by POST is not a ProjectInfo object")

      // TEMP - remove once backend does set `requiresSetup: true` for a new project
      await backend.patch<unknown>(`/projects/${response.id}`, {requiresSetup: true}, { version: 2 })

      return response
    },

    async getAvailableProjects(): Promise<Project[]> {
      const userProjects = await backend.get<unknown>(`/projects`, { version: 2 })
      assertIsArray(
        userProjects,
        "Assertion error in getAvailableProjects: value returned by GET /projects is not an array"
      )
      return userProjects.map((value, index) => {
        assertIsProject(
          value,
          `Assertion error in getAvailableProjects: user project value at index ${index} is not a ProjectInfo object`
        )
        return value
      })
    },

    async updateProject(projectId: string, patch: Partial<Project>): Promise<void> {
      await backend.patch<unknown>(`/projects/${projectId}`, patch, { version: 2 })
      return
    },
  }
}

function assertIsProject(value: unknown, message: string): asserts value is Project {
  assertIsObject(value, `${message}\nError in assertIsProject: value is not an object`)
  assertHasAllProperties(value, ["id", "name"], `${message}\nError in assertIsProject`)
}

function assertIsUserBasicInfo(value: unknown, message: string): asserts value is UserBasicInfo {
  assertIsObject(value, `${message}\nError in assertIsUserBasicInfo: value is not an object`)
  assertHasAllProperties(value, ["id", "email"], `${message}\nError in assertIsProject`)
  return
}

// /**
//  * Temporary method. Will get deprecated once API v2 starts returning `Project` type instead of `ProjectInfo` type.
//  *
//  * Casts `ProjectInfo` or `Project` input to a `Project` type by removing "_" in the beginning of each property name.
//  * If partial info is passed, the corresponding partial will be returned
//  * @param infoOrProject
//  * @returns
//  */
// function toProject<T extends Partial<ProjectInfo>>(
//   infoOrProject: T
// ): T extends ProjectInfo ? Project : Partial<Project> {
//   return Object.fromEntries(
//     Object.entries(infoOrProject).map(([key, value]) => {
//       if (key.startsWith("_")) return [key.slice(1), value]
//       if (key === "_requireSetup") return ["requiresSetup", value]
//       return [key, value]
//     })
//   ) as any
// }

// /**
//  * Temporary method. Will get deprecated once API v2 starts returning `Project` type instead of `ProjectInfo` type.
//  *
//  * Casts `Project` input to a `ProjectInfo` type by adding "_" in the beginning of each property name.
//  * If partial info is passed, the corresponding partial will be returned
//  * @param infoOrProject
//  * @returns
//  */
// function toProjectInfo<T extends Partial<Project>>(
//   infoOrProject: T
// ): T extends Project ? ProjectInfo : Partial<ProjectInfo> {
//   return Object.fromEntries(
//     Object.entries(infoOrProject).map(([key, value]) => [key.startsWith("_") ? key : `_${key}`, value])
//   ) as any
// }
