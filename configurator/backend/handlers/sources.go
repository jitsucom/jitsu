package handlers

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/entities"
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

			var destinationIDs []string
			for _, destinationID := range source.Destinations {
				destinationIDs = append(destinationIDs, projectID+"."+destinationID)
			}

			idConfig[sourceID] = mapConfig(source, destinationIDs)
		}
	}

	logging.Debugf("Sources response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, &ensources.Payload{Sources: idConfig})
}

func (sh *SourcesHandler) TestHandler(c *gin.Context) {
	sourceEntity := &entities.Source{}
	err := c.BindJSON(sourceEntity)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Failed to parse request body", Error: err.Error()})
		return
	}

	enSourceConfig := mapConfig(sourceEntity, []string{})

	b, err := json.Marshal(enSourceConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Failed to serialize source config", Error: err.Error()})
		return
	}

	code, content, err := sh.enService.TestSource(b)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Failed to get response from eventnative", Error: err.Error()})
		return
	}

	if code == http.StatusOK {
		c.JSON(http.StatusOK, middleware.OkResponse{Status: "Connection established"})
		return
	}

	c.Header("Content-Type", jsonContentType)
	c.Writer.WriteHeader(code)

	_, err = c.Writer.Write(content)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Failed to write response", Error: err.Error()})
	}
}

func mapConfig(source *entities.Source, destinationIDs []string) endrivers.SourceConfig {
	return endrivers.SourceConfig{
		Type:         source.SourceType,
		Destinations: destinationIDs,
		Collections:  source.Collections,
		Config:       source.Config,
		Schedule:     source.Schedule,
	}
}
