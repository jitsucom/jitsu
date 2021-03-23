package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

const telemetryCollection = "telemetry"
const telemetryGlobalId = "global"

type TelemetryHandler struct {
	configStorage storages.ConfigurationsStorage
}

func NewTelemetryHandler(configStorage storages.ConfigurationsStorage) *TelemetryHandler {
	return &TelemetryHandler{
		configStorage: configStorage,
	}
}

func (th *TelemetryHandler) GetHandler(c *gin.Context) {
	config, err := th.configStorage.Get(telemetryCollection, telemetryGlobalId)
	if err != nil {
		if err == storages.ErrConfigurationNotFound {
			c.JSON(http.StatusOK, map[string]interface{}{})
			return
		}

		errorMessage := fmt.Sprintf("Error getting telemetry configuration : %v", err)
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrorResponse{Error: errorMessage, Message: "Telemetry error"})
		return
	}

	c.Header("Content-Type", jsonContentType)
	c.Writer.WriteHeader(http.StatusOK)
	_, err = c.Writer.Write(config)
	if err != nil {
		writeErrorMessage := fmt.Sprintf("Failed to write response: %v", err)
		logging.Error(writeErrorMessage)
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: writeErrorMessage})
	}
}
