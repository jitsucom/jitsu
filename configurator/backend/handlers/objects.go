package handlers

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	mdlwr "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

const (
	commonUIDFieldName = "_uid"
)

type ObjectsHandler struct {
	configurationsService *storages.ConfigurationsService
}

func NewObjectHandler(configurationsService *storages.ConfigurationsService) *ObjectsHandler {
	return &ObjectsHandler{configurationsService: configurationsService}
}

func (oh *ObjectsHandler) GetObjectsByProjectIDAndObjectType(c *gin.Context, projectID, objectType string) {
	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	objects, err := oh.getObjects(projectID, objectType)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, mdlwr.ErrResponse(err.Error(), nil))
		return
	}
	writeResponse(c, objects)
}

func (oh *ObjectsHandler) SetObjectsByProjectIDAndObjectType(c *gin.Context, projectID, objectType string) {
	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	var data interface{}
	err := c.BindJSON(&data)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, mdlwr.ErrResponse(fmt.Sprintf("Failed to get objects body from request: %v", err), nil))
		return
	}
	err = oh.configurationsService.SaveConfigWithLock(objectType, projectID, data)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, mdlwr.ErrResponse(fmt.Sprintf("failed to save objects [%s], id=[%s]: %v", objectType, projectID, err), nil))
		return
	}
	c.JSON(http.StatusOK, mdlwr.OKResponse())
}

func (oh *ObjectsHandler) DeleteObjectsByProjectIDAndObjectTypeAndID(c *gin.Context, projectID, objectType, objectID string) {
	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	objectArrayPath := getObjectArrayPathByObjectType(objectType)
	objectMeta := &storages.ObjectMeta{
		IDFieldPath: commonUIDFieldName,
		Value:       objectID,
	}

	deletedObject, err := oh.configurationsService.DeleteObjectWithLock(objectType, projectID, objectArrayPath, objectMeta)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, mdlwr.ErrResponse(fmt.Sprintf("failed to delete object [%s] in project [%s], id=[%s]: %v", objectType, projectID, objectID, err), nil))
		return
	}

	writeResponse(c, deletedObject)

}

func (oh *ObjectsHandler) GetObjectsByProjectIDAndObjectTypeAndID(c *gin.Context, projectID, objectType, objectID string) {
	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	objectArrayPath := getObjectArrayPathByObjectType(objectType)
	objectMeta := &storages.ObjectMeta{
		IDFieldPath: commonUIDFieldName,
		Value:       objectID,
	}

	object, err := oh.configurationsService.GetObjectWithLock(objectType, projectID, objectArrayPath, objectMeta)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, mdlwr.ErrResponse(fmt.Sprintf("failed to get object [%s] in project [%s], id=[%s]: %v", objectType, projectID, objectID, err), nil))
		return
	}

	writeResponse(c, object)

}

func (oh *ObjectsHandler) PatchObjectsByProjectIDAndObjectTypeAndID(c *gin.Context, projectID, objectType, objectUID string) {
	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	patchObjectPayload := map[string]interface{}{}
	err := c.BindJSON(&patchObjectPayload)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, mdlwr.ErrResponse(fmt.Sprintf("failed to get patch object body from request: %v", err), nil))
		return
	}

	patchPayload := &storages.PatchPayload{
		ObjectArrayPath: getObjectArrayPathByObjectType(objectType),
		ObjectMeta: &storages.ObjectMeta{
			IDFieldPath: commonUIDFieldName,
			Value:       objectUID,
		},
		Patch: patchObjectPayload,
	}

	newObject, err := oh.configurationsService.PatchConfigWithLock(objectType, projectID, patchPayload)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, mdlwr.ErrResponse(fmt.Sprintf("failed to patch object [%s] in project [%s], id=[%s]: %v", objectType, projectID, objectUID, err), nil))
		return
	}

	writeResponse(c, newObject)
}

func (oh *ObjectsHandler) getObjects(projectID, objectType string) ([]byte, error) {
	config, err := oh.configurationsService.GetConfigWithLock(objectType, projectID)
	if err != nil {
		if err == storages.ErrConfigurationNotFound {
			return json.Marshal(make(map[string]interface{}))
		}
		return nil, fmt.Errorf("failed to get objects for object type=[%s], projectID=[%s]: %v", objectType, projectID, err)
	}

	return config, nil
}

//paths some entities arrays can be different from entity type
func getObjectArrayPathByObjectType(objectType string) string {
	switch objectType {
	case "api_keys":
		return "keys"
	default:
		return objectType
	}
}
