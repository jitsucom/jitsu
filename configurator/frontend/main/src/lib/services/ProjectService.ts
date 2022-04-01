/**
 * Class for working with projects and users
 */
import { Project, UserBasicInfo } from "../../generated/conf-openapi"
import { BackendApiClient } from "./BackendApiClient"
import { assertHasAllProperties, assertIsArray, assertIsObject } from "utils/typeCheck"
import { assert } from "../../utils/typeCheck"
import { withQueryParams } from "utils/queryParams"
import { concatenateURLs } from "lib/commons/utils"
import { getFullUiPath } from "lib/commons/pathHelper"
import { errorIncludes } from "utils/errorIncludes"

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
  unlinkFromProject(projectId: string, userId: string): Promise<void>
}

export function createProjectService(backend: BackendApiClient): ProjectService {
  return {
    async getProjectUsers(projectId: string): Promise<UserBasicInfo[]> {
      const response = await backend.get<unknown>(`/project/${projectId}/users`, { version: 2 })
      assertIsArray(response, "Assertion error in getProjectUsers: response is not an array")
      return response.map((value, index) => {
        assertIsUserBasicInfo(
          value,
          `Assertion error in getProjectUsers: element with index ${index} is not a valid UserBasicInfo object`
        )
        return value
      })
    },

    async linkUserToProject(projectId, link): Promise<"invitation_sent" | "user_linked"> {
      const response = await backend
        .post<unknown>(
          `/project/${projectId}/link`,
          { ...link, callback: concatenateURLs(getFullUiPath(), `/reset_password/{{token}}`) },
          { version: 2 }
        )
        .catch(error => {
          if (errorIncludes(error, "mail service")) {
            throw new Error(`SMTP is not configured on the server or the configuration is invalid.\nDetails: ${error}`)
          }
          throw error
        })

      assertIsObject(response, `Assertion error in linkUserToProject: response is not an object`)
      assert(
        response.userStatus === "existing" || response.userStatus === "created",
        `Assertion error in linkUserToProject: response.userStatus can only be "existing" or "created" but received ${response.userStatus}`
      )
      switch (response.userStatus) {
        case "existing":
          return "user_linked"
        case "created":
          return "invitation_sent"
      }
    },

    async unlinkFromProject(projectId: string, userId: string): Promise<void> {
      await backend.get<unknown>(withQueryParams(`/project/${projectId}/unlink`, { userId }), { version: 2 })
      return
    },

    async createProject(name: string): Promise<Project> {
      const response = await backend.post<unknown>("/projects", { name }, { version: 2 })
      assertIsProject(response, "Assertion error in createProject: value returned by POST is not a ProjectInfo object")
      // return response

      // TEMPORARY - remove once backend does set `requiresSetup: true` for a new project
      const result = await backend.patch<unknown>(`/projects/${response.id}`, { requiresSetup: true }, { version: 2 })
      assertIsProject(result, "Assertion error in createProject: value returned by PATCH is not a ProjectInfo object")
      return result
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
