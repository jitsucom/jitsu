package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

const telemetryUsageKey = "usage"

type TelemetryHandler struct {
	configService *storages.ConfigurationsService
}

func NewTelemetryHandler(configService *storages.ConfigurationsService) *TelemetryHandler {
	return &TelemetryHandler{
		configService: configService,
	}
}

func (th *TelemetryHandler) GetHandler(c *gin.Context) {
	config, err := th.configService.GetTelemetry()
	if err != nil {
		if err == storages.ErrConfigurationNotFound {
			c.JSON(http.StatusOK, map[string]interface{}{})
			return
		}

		c.JSON(http.StatusInternalServerError, enmiddleware.ErrResponse("Error getting telemetry configuration", err))
		return
	}

	c.Header("Content-Type", jsonContentType)
	c.Writer.WriteHeader(http.StatusOK)
	_, err = c.Writer.Write(config)
	if err != nil {
		writeErrorMessage := fmt.Sprintf("Failed to write response: %v", err)
		logging.Error(writeErrorMessage)
		c.JSON(http.StatusBadRequest, enmiddleware.ErrResponse(writeErrorMessage, nil))
	}
}
