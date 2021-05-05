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
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("[start] is a required query parameter", nil))
		return
	}
	start, err := time.Parse(time.RFC3339Nano, startStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing [start] query parameter", err))
		return
	}

	endStr := c.Query("end")
	if endStr == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("[end] is a required query parameter", nil))
		return
	}
	end, err := time.Parse(time.RFC3339Nano, endStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing [end] query parameter", err))
		return
	}

	granularityStr := c.Query("granularity")
	if granularityStr == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("[granularity] is a required query parameter", nil))
		return
	}

	granularity, err := meta.GranularityFromString(granularityStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing [granularity] query parameter", err))
		return
	}

	projectID := c.Query("project_id")

	projectEvents, err := sh.metaStorage.GetProjectEventsWithGranularity(projectID, start, end, granularity)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to provide statistics", err))
		return
	}

	response := StatisticsResponse{Data: projectEvents, Status: "ok"}
	c.JSON(http.StatusOK, response)
}
