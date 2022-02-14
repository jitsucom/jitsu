// @Services
import ApplicationServices from "lib/services/ApplicationServices"
import { ProjectSettings } from "../generated/conf-openapi"

export function loadProjectSettings(): Promise<ProjectSettings> {
  return ApplicationServices.get().backendApiClient.get(backendApiPath(), { version: 2 })
}

export function saveProjectSettings(patch: Partial<ProjectSettings>): Promise<any> {
  return ApplicationServices.get().backendApiClient.patch(backendApiPath(), patch, { version: 2 })
}

function backendApiPath(): string {
  return `/projects/${ApplicationServices.get().activeProject.id}/settings`
}

export type { ProjectSettings }
