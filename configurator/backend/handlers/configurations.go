package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	jmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

//DEPRECATED
//ConfigurationHandler is a handler for get/save configurations (apikeys/destinations/etc by projectID)
type ConfigurationHandler struct {
	configurationsService *storages.ConfigurationsService
}

//DEPRECATED
//NewConfigurationsHandler returns configured ConfigurationHandler
func NewConfigurationsHandler(configurationsService *storages.ConfigurationsService) *ConfigurationHandler {
	return &ConfigurationHandler{configurationsService: configurationsService}
}

//DEPRECATED
//GetConfig returns JSON with configuration entities by project ID and object type
//id = projectID and collection = objectType
func (ch *ConfigurationHandler) GetConfig(c *gin.Context) {
	projectID := c.Query("id")
	if projectID == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, jmiddleware.ErrResponse("Required query parameter [id] is empty", nil))
		return
	}

	if !hasAccessToProject(c, projectID) {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	collection := c.Param("collection")
	config, err := ch.getConfig(collection, projectID)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, jmiddleware.ErrResponse(err.Error(), nil))
		return
	}
	writeResponse(c, config)
}

//DEPRECATED
func (ch *ConfigurationHandler) StoreConfig(c *gin.Context) {
	projectID := c.Query("id")
	if projectID == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, jmiddleware.ErrResponse("Required query parameter [id] is empty", nil))
		return
	}

	if !hasAccessToProject(c, projectID) {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	collection := c.Param("collection")
	ch.saveConfig(c, collection, projectID)
}

func (ch *ConfigurationHandler) getConfig(collection string, id string) ([]byte, error) {
	config, err := ch.configurationsService.GetConfigWithLock(collection, id)
	if err != nil {
		if err == storages.ErrConfigurationNotFound {
			return json.Marshal(make(map[string]interface{}))
		}
		errorMessage := fmt.Sprintf("Failed to get config for collection=[%s], id=[%s]: %v", collection, id, err)
		return nil, errors.New(errorMessage)
	}
	return config, nil
}

func (ch *ConfigurationHandler) saveConfig(c *gin.Context, collection string, id string) {
	var data interface{}
	err := c.BindJSON(&data)
	if err != nil {
		bodyExtractionErrorMessage := fmt.Sprintf("Failed to get config body from request: %v", err)
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse(bodyExtractionErrorMessage, nil))
		return
	}
	_, err = ch.configurationsService.SaveConfigWithLock(collection, id, data)
	if err != nil {
		configStoreErrorMessage := fmt.Sprintf("Failed to save collection [%s], id=[%s]: %v", collection, id, err)
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse(configStoreErrorMessage, nil))
		return
	}
	c.JSON(http.StatusOK, jmiddleware.OKResponse())
}

func writeResponse(c *gin.Context, config []byte) {
	c.Header("Content-Type", jsonContentType)
	c.Writer.WriteHeader(http.StatusOK)
	_, err := c.Writer.Write(config)
	if err != nil {
		writeErrorMessage := fmt.Sprintf("Failed to write response: %v", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, jmiddleware.ErrResponse(writeErrorMessage, nil))
	}
}
