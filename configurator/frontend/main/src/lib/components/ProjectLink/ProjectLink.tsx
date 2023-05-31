import { generatePath, NavLink } from "react-router-dom"
import { useServices } from "../../../hooks/useServices"
import { ExtractRouteParams } from "react-router"
import ApplicationServices from "../../services/ApplicationServices"

export type ProjectLinkProps = {
  to: string
  /** Allows to conditionally strip link */
  stripLink?: boolean
  className?: string
}
/**
 * Link to page within project hierarchy. It should be used instead <NavLink /> in most cases
 */
const ProjectLink: React.FC<ProjectLinkProps> = ({ to, children, stripLink, ...rest }) => {
  const services = useServices()
  const projectId = services.activeProject.id
  return stripLink ? (
    <>{children}</>
  ) : (
    <NavLink to={`/prj-${projectId}${to}`} {...rest}>
      {children??<></>}
    </NavLink>
  )
}

/**
 * Prefixes any valid relative URL with `/prj-{current_project_id}`
 * @param pattern either a regular link like `/live-events` or a pattern with indicated project id like `/prj-:projectId/live-events`
 * @param params
 * @returns
 */
export function projectRoute(pattern: string, params: ExtractRouteParams<string> = {}): string {
  pattern = pattern.includes("/prj-") ? pattern : `/prj-:projectId${pattern.startsWith("/") ? pattern : `/${pattern}`}`
  return generatePath(pattern, { projectId: ApplicationServices.get().activeProject.id, ...params })
}

export function stripProjectFromRoute(route: string): string {
  return route.replace(`/prj-${ApplicationServices.get().activeProject.id}`, "")
}

export default ProjectLink
