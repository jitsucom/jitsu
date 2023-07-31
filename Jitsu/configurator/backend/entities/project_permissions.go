package entities

import "github.com/jitsucom/jitsu/configurator/openapi"

type ProjectPermissions openapi.PermissionsInfo

const (
	ViewConfigPermission   openapi.ProjectPermission = "view_config"
	ModifyConfigPermission openapi.ProjectPermission = "modify_config"
)

var DefaultProjectPermissions = ProjectPermissions{
	Permissions: &[]openapi.ProjectPermission{ViewConfigPermission, ModifyConfigPermission},
}

func (p *ProjectPermissions) ObjectType() string {
	return "permission"
}
