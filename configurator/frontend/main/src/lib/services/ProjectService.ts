/**
 * Class for working with projects and users
 */
import { Project } from "../../generated/conf-openapi"
import { UserService } from "./UserService"
import { BackendApiClient } from "./BackendApiClient"
import { randomId } from "../../utils/numbers"
import { UserDTO } from "./model"
import { assert } from "../../utils/typeCheck"

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

  getProjectById(projectId: string): Promise<Project>

  /**
   * Patches the project with provided data. Project ID field is required.
   */
  updateProject(project: Partial<Project> & { id: string }): Promise<void>
}

export function createProjectService_v1(userService: UserService, backend: BackendApiClient): ProjectService {
  return {
    async createProject(projectName: string, planId: string = "free"): Promise<Project> {
      let userInfo: UserDTO = await backend.get(`/users/info`)
      if (userInfo._project && userInfo._project) {
        throw new Error(
          `At the moment, user can have only one project. Current user has linked ${JSON.stringify(userInfo._project)}`
        )
      }
      let newId = randomId()
      userInfo._project = {
        $type: "Project",
        _setupCompleted: false,
        _id: newId,
        _name: projectName,
      }
      await backend.post(`/users/info`, userInfo)
      return { id: newId, name: projectName, setupCompleted: false }
    },

    async getAvailableProjects(): Promise<Project[]> {
      let userInfo: UserDTO = await backend.get(`/users/info`)
      if (!userInfo._project) {
        return []
      } else {
        return [
          {
            id: userInfo._project._id,
            name: userInfo._project._name,
            setupCompleted: userInfo._project._setupCompleted === undefined ? true : userInfo._project._setupCompleted,
          },
        ]
      }
    },
    async updateProject(project: Partial<Project> & { id: string }): Promise<void> {
      assert(!!project.id, "Project id is required")
      let userInfo: UserDTO = await backend.get(`/users/info`)
      assert(!!userInfo._project, "User doesn't have attached project")
      assert(
        userInfo._project._id === project.id,
        `Project id doesn't match, local: ${project.id}, server: ${userInfo._project._id}`
      )
      userInfo._project = {
        ...(userInfo._project || {}),
        $type: "Project",
        _id: project.id,
        _name: project.name || userInfo._project._name,
        _setupCompleted: project.setupCompleted || userInfo._project._setupCompleted,
      }
      await backend.post(`/users/info`, userInfo)
    },
    async getProjectById(projectId: string): Promise<Project | null> {
      let userInfo = await backend.get(`/users/info`)
      if (!userInfo._project || userInfo._project._id !== projectId) {
        return null
      } else {
        return { id: userInfo._project._id, name: userInfo._project._name }
      }
    },
  }
}
