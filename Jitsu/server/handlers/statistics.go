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

//536-issue DEPRECATED
func (sh *StatisticsHandler) DeprecatedGetHandler(c *gin.Context) {
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
	ids, err := sh.extractIDs(projectID, namespaceFilter, c)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to get statistics identifiers", err))
		return
	}

	eventsPerTime, err := sh.metaStorage.GetEventsWithGranularity(namespaceFilter, statusFilter, "", ids, start, end, granularity)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to provide statistics", err))
		return
	}

	response := StatisticsResponse{Data: eventsPerTime, Status: "ok"}
	c.JSON(http.StatusOK, response)
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

	if namespaceFilter != meta.SourceNamespace &&
		namespaceFilter != meta.DestinationNamespace {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(fmt.Sprintf("Unknown [namespace] value: %s. Only ['%s', '%s'] are supported", namespaceFilter, meta.SourceNamespace, meta.DestinationNamespace), nil))
		return
	}

	typeFilter := c.Query("type")
	if typeFilter == "" {
		typeFilter = meta.PushEventType
	}

	if typeFilter != meta.PushEventType &&
		typeFilter != meta.PullEventType {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(fmt.Sprintf("Unknown [type] value: %s. Only ['%s', '%s'] are supported", typeFilter, meta.PushEventType, meta.PullEventType), nil))
		return
	}

	projectID := c.Query("project_id")
	ids, err := sh.extractIDs(projectID, namespaceFilter, c)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to get statistics identifiers", err))
		return
	}

	eventsPerTime, err := sh.metaStorage.GetEventsWithGranularity(namespaceFilter, statusFilter, typeFilter, ids, start, end, granularity)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to provide statistics", err))
		return
	}

	response := StatisticsResponse{Data: eventsPerTime, Status: "ok"}
	c.JSON(http.StatusOK, response)
}

func (sh *StatisticsHandler) extractIDs(projectID, namespace string, c *gin.Context) ([]string, error) {
	switch namespace {
	case meta.DestinationNamespace:
		destinationID := c.Query("destination_id")
		if destinationID != "" {
			return []string{destinationID}, nil
		}

		return sh.metaStorage.GetProjectDestinationIDs(projectID)

	case meta.SourceNamespace:
		sourceID := c.Query("source_id")
		if sourceID != "" {
			return []string{sourceID}, nil
		}

		return sh.metaStorage.GetProjectSourceIDs(projectID)

		//536-issue DEPRECATED (all case branch)
	case meta.PushSourceNamespace:
		sourceID := c.Query("source_id")
		if sourceID != "" {
			return []string{sourceID}, nil
		}

		return sh.metaStorage.GetProjectPushSourceIDs(projectID)
	default:
		return nil, fmt.Errorf("Unknown [namespace] value: %s. Only ['%s', '%s', '%s'] are supported", namespace, meta.SourceNamespace, meta.PushSourceNamespace, meta.DestinationNamespace)
	}
}
