package handlers

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/destinations"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/eventnative"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	enadapters "github.com/jitsucom/jitsu/server/adapters"
	endestinations "github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/logging"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	enstorages "github.com/jitsucom/jitsu/server/storages"
	"net/http"
	"time"
)

const (
	defaultStatisticsPostgresDestinationId = "statistics.postgres"
)

type DestinationsHandler struct {
	configurationsService *storages.ConfigurationsService
	defaultS3             *enadapters.S3Config
	statisticsPostgres    *enstorages.DestinationConfig

	enService *eventnative.Service
}

func NewDestinationsHandler(configurationsService *storages.ConfigurationsService, defaultS3 *enadapters.S3Config, statisticsPostgres *enstorages.DestinationConfig,
	enService *eventnative.Service) *DestinationsHandler {
	return &DestinationsHandler{
		configurationsService: configurationsService,
		defaultS3:             defaultS3,
		statisticsPostgres:    statisticsPostgres,
		enService:             enService,
	}
}

func (dh *DestinationsHandler) GetHandler(c *gin.Context) {
	begin := time.Now()
	destinationsMap, err := dh.configurationsService.GetDestinations()
	if err != nil {
		logging.Error(err)
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrorResponse{Error: err.Error(), Message: "Destinations err"})
		return
	}

	idConfig := map[string]enstorages.DestinationConfig{}
	keysByProject, err := dh.configurationsService.GetApiKeysGroupByProjectId()
	if err != nil {
		logging.Errorf("Error getting api keys grouped by project id. All destinations will be skipped: %v", err)
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrorResponse{Error: err.Error(), Message: "Failed to get API keys"})
		return
	}
	for projectId, destinationsEntity := range destinationsMap {
		if len(destinationsEntity.Destinations) == 0 {
			continue
		}

		//if only tokens empty - put all tokens by project
		keys, ok := keysByProject[projectId]
		if !ok {
			logging.Errorf("No API keys for project [%s], all destinations will be skipped", projectId)
			continue
		}

		if len(keys) == 0 {
			continue
		}

		var projectTokenIds []string
		for _, k := range keys {
			projectTokenIds = append(projectTokenIds, k.Id)
		}

		for _, destination := range destinationsEntity.Destinations {
			destinationId := projectId + "." + destination.Uid
			enDestinationConfig, err := destinations.MapConfig(destinationId, destination, dh.defaultS3)
			if err != nil {
				logging.Errorf("Error mapping destination config for destination type: %s id: %s projectId: %s err: %v", destination.Type, destination.Uid, projectId, err)
				continue
			}

			if len(destination.OnlyKeys) > 0 {
				enDestinationConfig.OnlyTokens = destination.OnlyKeys
			} else {
				enDestinationConfig.OnlyTokens = projectTokenIds
			}
			idConfig[destinationId] = *enDestinationConfig
		}
	}
	if dh.statisticsPostgres != nil {
		//default statistic destination
		idConfig[defaultStatisticsPostgresDestinationId] = *dh.statisticsPostgres
	}

	logging.Debugf("Destinations response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, &endestinations.Payload{Destinations: idConfig})
}

func (dh *DestinationsHandler) TestHandler(c *gin.Context) {
	destinationEntity := &entities.Destination{}
	err := c.BindJSON(destinationEntity)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Failed to parse request body", Error: err.Error()})
		return
	}

	enDestinationConfig, err := destinations.MapConfig("test_connection", destinationEntity, dh.defaultS3)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: fmt.Sprintf("Failed to map [%s] firebase config to eventnative format", destinationEntity.Type), Error: err.Error()})
		return
	}

	b, err := json.Marshal(enDestinationConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Failed to serialize destination config", Error: err.Error()})
		return
	}

	code, content, err := dh.enService.TestDestination(b)
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
