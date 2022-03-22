import { generatePath, NavLink } from "react-router-dom"
import { useServices } from "../../../hooks/useServices"
import { ExtractRouteParams } from "react-router"
import ApplicationServices from "../../services/ApplicationServices"

export type ProjectLinkProps = {
  to: string
  className?: string
}
/**
 * Link to page within project hierarchy. It should be used instead <NavLink /> in most cases
 */
const ProjectLink: React.FC<ProjectLinkProps> = ({ to, children, ...rest }) => {
  const services = useServices()
  const projectId = services.activeProject.id
  return (
    <NavLink to={`/prj-${projectId}${to}`} {...rest}>
      {children}
    </NavLink>
  )
}

export function projectRoute(pattern: string, params: ExtractRouteParams<string> = {}): string {
  return generatePath(pattern, { projectId: ApplicationServices.get().activeProject.id, ...params })
}

export function stripProjectFromRoute(route: string): string {
  return route.replace(`/prj-${ApplicationServices.get().activeProject.id}`, "")
}

export default ProjectLink
