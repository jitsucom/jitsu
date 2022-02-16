/**
 * Class for working with projects and users
 */
import { Project } from "../../generated/conf-openapi"
import { UserService } from "./UserService"
import { BackendApiClient } from "./BackendApiClient"
import { randomId } from "../../utils/numbers"

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
}

export function createProjectService_v1(userService: UserService, backend: BackendApiClient): ProjectService {
  return {
    async createProject(projectName: string, planId: string = "free"): Promise<Project> {
      let userInfo = await this.backendApi.get(`/users/info`)
      if (userInfo._project && userInfo._project) {
        throw new Error(
          `At the moment, user can have only one project. Current user has linked ${JSON.stringify(userInfo._project)}`
        )
      }
      let newId = randomId()
      userInfo._project = {
        $type: "Project",
        _id: newId,
        _name: projectName,
        _planId: planId,
      }
      return { id: newId, name: projectName, planId: planId }
    },
    async getAvailableProjects(): Promise<Project[]> {
      let userInfo = await this.backendApi.get(`/users/info`)
      if (!userInfo._project) {
        return []
      } else {
        return [
          { id: userInfo._project._id, name: userInfo._project._name, planId: userInfo._project._planId || "free" },
        ]
      }
    },
    async getProjectById(projectId: string): Promise<Project | null> {
      let userInfo = await this.backendApi.get(`/users/info`);
      if (!userInfo._project || userInfo._project._id !== projectId) {
        return null;
      } else {
        return { id: userInfo._project._id, name: userInfo._project._name, planId: userInfo._project._planId || "free" };
      }
    },

  }
}
