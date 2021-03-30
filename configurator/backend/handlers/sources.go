package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/eventnative"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	endrivers "github.com/jitsucom/jitsu/server/drivers"
	"github.com/jitsucom/jitsu/server/logging"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	ensources "github.com/jitsucom/jitsu/server/sources"
	"net/http"
	"time"
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

func (sh *SourcesHandler) GetHandler(c *gin.Context) {
	begin := time.Now()
	sourcesMap, err := sh.configurationsService.GetSources()
	if err != nil {
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrorResponse{Error: err.Error(), Message: "Sources err"})
		return
	}

	idConfig := map[string]endrivers.SourceConfig{}
	for projectID, sourcesEntity := range sourcesMap {
		if len(sourcesEntity.Sources) == 0 {
			continue
		}

		for _, source := range sourcesEntity.Sources {
			sourceID := projectID + "." + source.SourceID

			idConfig[sourceID] = endrivers.SourceConfig{
				Type:         source.SourceType,
				Destinations: source.Destinations,
				Collections:  source.Collections,
				Config:       source.Config,
			}
		}
	}

	logging.Debugf("Sources response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, &ensources.Payload{Sources: idConfig})
}

func (sh *SourcesHandler) TestHandler(c *gin.Context) {
	c.JSON(http.StatusOK, middleware.OkResponse{Status: "Connection established"})
	return
}
