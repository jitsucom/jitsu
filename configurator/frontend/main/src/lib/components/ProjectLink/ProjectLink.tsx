import { NavLink } from "react-router-dom"
import { useServices } from "../../../hooks/useServices"

export type ProjectLinkProps = {
  to: string
  className?: string
}
/**
 * Link to page within project hierarchy. It should be used instead <NavLink /> in most cases
 */
const ProjectLink: React.FC<ProjectLinkProps> = ({ to, children, ...rest }) => {
  const services = useServices();
  const projectId = services.activeProject.id;
  return <NavLink to={`/prj_${projectId}${to}`} {...rest}>{children}</NavLink>
}

export default ProjectLink;
