package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	mdlwr "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

type ConfigurationHandler struct {
	configurationsService *storages.ConfigurationsService
	configStorage         storages.ConfigurationsStorage
}

func NewConfigurationsHandler(configurationsService *storages.ConfigurationsService, configStorage storages.ConfigurationsStorage) *ConfigurationHandler {
	return &ConfigurationHandler{configurationsService: configurationsService, configStorage: configStorage}
}

func (ch *ConfigurationHandler) GetConfig(c *gin.Context) {
	configID := c.Query("id")
	if configID == "" {
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse("Required query parameter [id] is empty", nil))
		return
	}
	collection := c.Param("collection")
	config, err := ch.getConfig(collection, configID)
	if err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse(err.Error(), nil))
		return
	}
	writeResponse(c, config)
}

func (ch *ConfigurationHandler) StoreConfig(c *gin.Context) {
	configID := c.Query("id")
	if configID == "" {
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse("Required query parameter [id] is empty", nil))
		return
	}
	collection := c.Param("collection")
	ch.saveConfig(c, collection, configID)
}

func (ch *ConfigurationHandler) GetUserInfo(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)

	config, err := ch.getConfig(authorization.UsersInfoCollection, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse(err.Error(), nil))
		return
	}
	writeResponse(c, config)
}

//StoreUserInfo save user info data after onboarding
func (ch *ConfigurationHandler) StoreUserInfo(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)

	data := map[string]interface{}{}
	err := c.BindJSON(&data)
	if err != nil {
		bodyExtractionErrorMessage := fmt.Sprintf("Failed to get user info body from request: %v", err)
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse(bodyExtractionErrorMessage, nil))
		return
	}
	err = ch.configurationsService.StoreConfig(authorization.UsersInfoCollection, userID, data)
	if err != nil {
		configStoreErrorMessage := fmt.Sprintf("Failed to save user info [%s]: %v", userID, err)
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse(configStoreErrorMessage, nil))
		return
	}

	c.JSON(http.StatusOK, mdlwr.OKResponse())
}

func (ch *ConfigurationHandler) getConfig(collection string, id string) ([]byte, error) {
	config, err := ch.configStorage.Get(collection, id)
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
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse(bodyExtractionErrorMessage, nil))
		return
	}
	err = ch.configurationsService.StoreConfig(collection, id, data)
	if err != nil {
		configStoreErrorMessage := fmt.Sprintf("Failed to save collection [%s], id=[%s]: %v", collection, id, err)
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse(configStoreErrorMessage, nil))
		return
	}
	c.JSON(http.StatusOK, mdlwr.OKResponse())
}

func writeResponse(c *gin.Context, config []byte) {
	c.Header("Content-Type", jsonContentType)
	c.Writer.WriteHeader(http.StatusOK)
	_, err := c.Writer.Write(config)
	if err != nil {
		writeErrorMessage := fmt.Sprintf("Failed to write response: %v", err)
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse(writeErrorMessage, nil))
	}
}
