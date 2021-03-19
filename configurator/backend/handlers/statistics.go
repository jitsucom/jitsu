package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/configurator/middleware"
	"github.com/jitsucom/eventnative/configurator/statistics"
	"github.com/jitsucom/eventnative/configurator/storages"
	"github.com/jitsucom/eventnative/server/logging"
	enmdlwr "github.com/jitsucom/eventnative/server/middleware"
	"net/http"
	"time"
)

type ResponseBody struct {
	Status string                     `json:"status"`
	Data   []statistics.EventsPerTime `json:"data"`
}

type StatisticsHandler struct {
	storage               statistics.Storage
	configurationsService *storages.ConfigurationsService
}

func NewStatisticsHandler(storage statistics.Storage, configurationsService *storages.ConfigurationsService) *StatisticsHandler {
	return &StatisticsHandler{storage: storage, configurationsService: configurationsService}
}

func (sh *StatisticsHandler) GetHandler(c *gin.Context) {
	begin := time.Now()
	projectId := c.Query("project_id")
	if projectId == "" {
		c.JSON(http.StatusBadRequest, enmdlwr.ErrorResponse{Message: "[project_id] is a required query parameter"})
		return
	}

	userProjectId := c.GetString(middleware.ProjectIdKey)
	if userProjectId == "" {
		logging.Error(systemErrProjectId)
		c.JSON(http.StatusUnauthorized, enmdlwr.ErrorResponse{Error: systemErrProjectId.Error(), Message: "Authorization error"})
		return
	}

	if userProjectId != projectId {
		c.JSON(http.StatusUnauthorized, enmdlwr.ErrorResponse{Message: "User does not have access to project " + projectId})
		return
	}

	startStr := c.Query("start")
	if startStr == "" {
		c.JSON(http.StatusBadRequest, enmdlwr.ErrorResponse{Message: "[start] is a required query parameter"})
		return
	}
	start, err := time.Parse(time.RFC3339Nano, startStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmdlwr.ErrorResponse{Message: "Error parsing [start] query parameter", Error: err.Error()})
		return
	}

	endStr := c.Query("end")
	if endStr == "" {
		c.JSON(http.StatusBadRequest, enmdlwr.ErrorResponse{Message: "[end] is a required query parameter"})
		return
	}
	end, err := time.Parse(time.RFC3339Nano, endStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmdlwr.ErrorResponse{Message: "Error parsing [end] query parameter", Error: err.Error()})
		return
	}

	granularity := c.Query("granularity")
	if granularity != statistics.DayGranularity && granularity != statistics.HourGranularity {
		c.JSON(http.StatusBadRequest, enmdlwr.ErrorResponse{Message: statistics.ErrParsingGranularityMsg})
		return
	}

	data, err := sh.storage.GetEvents(projectId, start, end, granularity)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmdlwr.ErrorResponse{Message: "Failed to provide statistics", Error: err.Error()})
		logging.Errorf("Failed to provide statistics project_id[%s]: %v", projectId, err)
		return
	}

	logging.Debugf("Statistics %s project %s response in [%.2f] seconds", granularity, projectId, time.Now().Sub(begin).Seconds())
	response := ResponseBody{Data: data, Status: "ok"}
	c.JSON(http.StatusOK, response)
}
