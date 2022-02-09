// @Services
import ApplicationServices from "lib/services/ApplicationServices"

export type ProjectSettings = {
  notifications?: {
    slack?: {
      url?: string
    }
  },
}

export interface IProjectSettingsStore {
  get(): Promise<ProjectSettings>
  patch(patch: Partial<ProjectSettings>): Promise<any>
}

class ProjectSettingsStore implements IProjectSettingsStore {

  constructor() {

  }

  get(): Promise<ProjectSettings> {
    return ApplicationServices.get().backendApiClient.get(ProjectSettingsStore.path(), {version: 2})
  }

  patch(patch: Partial<ProjectSettings>): Promise<any> {
    return ApplicationServices.get().backendApiClient.patch(ProjectSettingsStore.path(), patch, {version: 2})
  }

  private static path(): string {
    return `/projects/${ApplicationServices.get().activeProject.id}/settings`
  }
}

export const projectSettingsStore = new ProjectSettingsStore()