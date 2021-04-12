package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"time"
)

type StatisticsResponse struct {
	Status string               `json:"status"`
	Data   []meta.EventsPerTime `json:"data"`
}

type StatisticsHandler struct {
	metaStorage meta.Storage
}

func NewStatisticsHandler(metaStorage meta.Storage) *StatisticsHandler {
	return &StatisticsHandler{metaStorage: metaStorage}
}

func (sh *StatisticsHandler) GetHandler(c *gin.Context) {
	startStr := c.Query("start")
	if startStr == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "[start] is a required query parameter"})
		return
	}
	start, err := time.Parse(time.RFC3339Nano, startStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing [start] query parameter", Error: err.Error()})
		return
	}

	endStr := c.Query("end")
	if endStr == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "[end] is a required query parameter"})
		return
	}
	end, err := time.Parse(time.RFC3339Nano, endStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing [end] query parameter", Error: err.Error()})
		return
	}

	granularityStr := c.Query("granularity")
	if granularityStr == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "[granularity] is a required query parameter"})
		return
	}

	granularity, err := meta.GranularityFromString(granularityStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing [granularity] query parameter", Error: err.Error()})
		return
	}

	projectID := c.Query("project_id") //Optional

	projectEvents, err := sh.metaStorage.GetProjectEventsWithGranularity(projectID, start, end, granularity)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to provide statistics", Error: err.Error()})
		return
	}

	response := StatisticsResponse{Data: projectEvents, Status: "ok"}
	c.JSON(http.StatusOK, response)
}
