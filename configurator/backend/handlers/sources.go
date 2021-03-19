package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/configurator/eventnative"
	"github.com/jitsucom/eventnative/configurator/middleware"
	"github.com/jitsucom/eventnative/configurator/storages"
	"net/http"
)

type SourcesHandler struct {
	configurationsService *storages.ConfigurationsService

	enService *eventnative.Service
}

func NewSourcesHandler(configurationsService *storages.ConfigurationsService, enService *eventnative.Service) *SourcesHandler {
	return &SourcesHandler{
		configurationsService: configurationsService,
		enService:             enService,
	}
}

func (sh *SourcesHandler) TestHandler(c *gin.Context) {
	c.JSON(http.StatusOK, middleware.OkResponse{Status: "Connection established"})
	return
}
