package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/openapi"
)

//OpenAPI is an openapi.ServerInterface implementation wrapper
type OpenAPI struct {
	authHandler             *AuthorizationHandler
	jConfigurationsHandler  *ConfigurationHandler
	systemHandler           *SystemHandler
	geoDataResolversHandler *GeoDataResolversHandler
	objectsHandler          *ObjectsHandler
	projectsHandler         *ProjectsHandler
}

func NewOpenAPI(authHandler *AuthorizationHandler, jConfigurationsHandler *ConfigurationHandler, systemHandler *SystemHandler,
	geoDataResolversHandler *GeoDataResolversHandler, objectsHandler *ObjectsHandler, projectsHandler *ProjectsHandler) *OpenAPI {
	return &OpenAPI{
		authHandler:             authHandler,
		jConfigurationsHandler:  jConfigurationsHandler,
		systemHandler:           systemHandler,
		geoDataResolversHandler: geoDataResolversHandler,
		objectsHandler:          objectsHandler,
		projectsHandler:         projectsHandler,
	}
}

func (oa *OpenAPI) GetGeoDataResolvers(c *gin.Context) {
	//check if middleware has aborted the request
	if c.IsAborted() {
		return
	}

	oa.geoDataResolversHandler.GetHandler(c)
}

func (oa *OpenAPI) GetSystemConfiguration(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.systemHandler.GetConfiguration(c)
}

func (oa *OpenAPI) GetSystemVersion(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.systemHandler.GetSystemVersion(c)
}

func (oa *OpenAPI) GetUsersInfo(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.jConfigurationsHandler.GetUserInfo(c)
}

func (oa *OpenAPI) SetUsersInfo(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.jConfigurationsHandler.StoreUserInfo(c)
}

func (oa *OpenAPI) UsersOnboardedSignUp(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.authHandler.OnboardedSignUp(c)
}

func (oa *OpenAPI) UsersPasswordChange(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.authHandler.ChangePassword(c)
}

func (oa *OpenAPI) UsersPasswordReset(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.authHandler.ResetPassword(c)
}

func (oa *OpenAPI) UsersSignIn(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.authHandler.SignIn(c)
}

func (oa *OpenAPI) UsersSignOut(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.authHandler.SignOut(c)
}

func (oa *OpenAPI) UsersTokenRefresh(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.authHandler.RefreshToken(c)
}

func (oa *OpenAPI) GetObjectsByProjectIDAndObjectType(c *gin.Context, projectID openapi.ProjectId, objectType openapi.ObjectType) {
	if c.IsAborted() {
		return
	}

	oa.objectsHandler.GetObjectsByProjectIDAndObjectType(c, string(projectID), string(objectType))
}

func (oa *OpenAPI) SetObjectsByProjectIDAndObjectType(c *gin.Context, projectID openapi.ProjectId, objectType openapi.ObjectType) {
	if c.IsAborted() {
		return
	}

	oa.objectsHandler.SetObjectsByProjectIDAndObjectType(c, string(projectID), string(objectType))
}

func (oa *OpenAPI) DeleteObjectsByProjectIDAndObjectTypeAndID(c *gin.Context, projectID openapi.ProjectId, objectType openapi.ObjectType, objectUID openapi.ObjectUid) {
	if c.IsAborted() {
		return
	}

	oa.objectsHandler.DeleteObjectsByProjectIDAndObjectTypeAndID(c, string(projectID), string(objectType), string(objectUID))
}

func (oa *OpenAPI) GetObjectsByProjectIDAndObjectTypeAndID(c *gin.Context, projectID openapi.ProjectId, objectType openapi.ObjectType, objectUID openapi.ObjectUid) {
	if c.IsAborted() {
		return
	}

	oa.objectsHandler.GetObjectsByProjectIDAndObjectTypeAndID(c, string(projectID), string(objectType), string(objectUID))
}

func (oa *OpenAPI) PatchObjectsByProjectIDAndObjectTypeAndID(c *gin.Context, projectID openapi.ProjectId, objectType openapi.ObjectType, objectUID openapi.ObjectUid) {
	if c.IsAborted() {
		return
	}

	oa.objectsHandler.PatchObjectsByProjectIDAndObjectTypeAndID(c, string(projectID), string(objectType), string(objectUID))
}

func (oa *OpenAPI) GetProjects(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	oa.projectsHandler.GetProjects(c)
}
