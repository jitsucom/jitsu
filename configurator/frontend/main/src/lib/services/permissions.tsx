import useProject from "../../hooks/useProject"
import { ErrorCard } from "../components/ErrorCard/ErrorCard"
import { ProjectPermission } from "../../generated/conf-openapi"

export const allPermissions: ProjectPermission[] = [ProjectPermission.VIEW_CONFIG, ProjectPermission.MODIFY_CONFIG]

export function withPermissionRequirement(Component, ...permissions: ProjectPermission[]): React.FC<any> {
  return props => {
    const project = useProject()
    if (permissions.every(p => ((project.permissions || []) as string[]).includes(p))) {
      return <Component {...props} />
    }
    return (
      <div className="flex justify-center">
        <ErrorCard
          title="You're not authorize to see this page"
          description={<>Your permissions are: {project.permissions?.join(", ") || "none"}</>}
        />
      </div>
    )
  }
}
