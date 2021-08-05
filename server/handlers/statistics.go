package handlers

import (
	"fmt"
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

	statusFilter := c.Query("status")
	if statusFilter == "" {
		statusFilter = meta.SuccessStatus
	}

	if statusFilter != meta.SuccessStatus &&
		statusFilter != meta.ErrorStatus &&
		statusFilter != meta.SkipStatus {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(fmt.Sprintf("Unknown [status] value: %s. Only ['%s', '%s', '%s'] are supported", statusFilter, meta.SuccessStatus, meta.SkipStatus, meta.ErrorStatus), nil))
		return
	}

	namespaceFilter := c.Query("namespace")
	if namespaceFilter == "" {
		namespaceFilter = meta.SourceNamespace
	}

	projectID := c.Query("project_id")

	var eventsPerTime []meta.EventsPerTime

	switch namespaceFilter {
	case meta.DestinationNamespace:
		destinationID := c.Query("destination_id")
		destinationIDs := []string{destinationID}
		if destinationID == "" {
			destinationIDs, err = sh.metaStorage.GetProjectDestinationIDs(projectID)
			if err != nil {
				c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to get destinations statistics", err))
				return
			}
		}

		eventsPerTime, err = sh.metaStorage.GetEventsWithGranularity(meta.DestinationNamespace, statusFilter, destinationIDs, start, end, granularity)
	case meta.SourceNamespace:
		sourceID := c.Query("source_id")
		sourceIDs := []string{sourceID}
		if sourceID == "" {
			sourceIDs, err = sh.metaStorage.GetProjectSourceIDs(projectID)
			if err != nil {
				c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to get sources statistics", err))
				return
			}
		}

		eventsPerTime, err = sh.metaStorage.GetEventsWithGranularity(meta.SourceNamespace, statusFilter, sourceIDs, start, end, granularity)
	default:
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(fmt.Sprintf("Unknown [namespace] value: %s. Only ['%s', '%s'] are supported", namespaceFilter, meta.SourceNamespace, meta.DestinationNamespace), nil))
		return
	}

	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to provide statistics", err))
		return
	}

	response := StatisticsResponse{Data: eventsPerTime, Status: "ok"}
	c.JSON(http.StatusOK, response)
}
