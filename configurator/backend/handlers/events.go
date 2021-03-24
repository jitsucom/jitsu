package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/eventnative"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	enevents "github.com/jitsucom/jitsu/server/events"
	enhandlers "github.com/jitsucom/jitsu/server/handlers"
	"github.com/jitsucom/jitsu/server/logging"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/timestamp"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type EventsHandler struct {
	configurationsProvider *storages.ConfigurationsService
	enService              *eventnative.Service
}

func NewEventsHandler(configurationsProvider *storages.ConfigurationsService, enService *eventnative.Service) *EventsHandler {
	return &EventsHandler{
		configurationsProvider: configurationsProvider,
		enService:              enService,
	}
}

func (eh *EventsHandler) OldGetHandler(c *gin.Context) {
	begin := time.Now()
	limit := 100
	limitStr := c.Query("limit")
	if limitStr != "" {
		limitInt, err := strconv.Atoi(limitStr)
		if err != nil {
			logging.Errorf("Error parsing [limit] query parameter")
		} else {
			limit = limitInt
		}
	}

	projectID := c.Query("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "[project_id] is a required query parameter"})
		return
	}

	userProjectID := c.GetString(middleware.ProjectIDKey)
	if userProjectID == "" {
		logging.SystemError(ErrProjectIDNotFoundInContext)
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Error: ErrProjectIDNotFoundInContext.Error(), Message: "Authorization error"})
		return
	}

	if userProjectID != projectID {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Message: "User does not have access to project " + projectID})
		return
	}

	apiKeysObjects, err := eh.configurationsProvider.GetAPIKeysByProjectID(projectID)
	if err != nil {
		logging.Errorf("Error getting api keys for [%s] project. All destinations will be skipped: %v", projectID, err)
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Error getting api keys for project " + projectID})
		return
	}
	if len(apiKeysObjects) == 0 {
		c.JSON(http.StatusOK, enhandlers.OldCachedEventsResponse{Events: []enevents.Event{}})
		return
	}

	var apiKeys []string
	for _, keyObject := range apiKeysObjects {
		apiKeys = append(apiKeys, keyObject.ServerSecret, keyObject.ClientSecret)
	}

	events, err := eh.enService.GetOldEvents(apiKeys, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrorResponse{Message: "Events err", Error: err.Error()})
		return
	}

	logging.Debugf("Events response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, enhandlers.OldCachedEventsResponse{Events: events})
}

func (eh *EventsHandler) GetHandler(c *gin.Context) {
	begin := time.Now()
	limit := 100
	limitStr := c.Query("limit")
	if limitStr != "" {
		limitInt, err := strconv.Atoi(limitStr)
		if err != nil {
			logging.Errorf("Error parsing [limit] query parameter")
		} else {
			limit = limitInt
		}
	}

	start := c.Query("start")
	if start == "" {
		start = time.Time{}.Format(timestamp.Layout)
	}

	end := c.Query("end")
	if end == "" {
		end = time.Now().UTC().Format(timestamp.Layout)
	}

	projectID := c.Query("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "[project_id] is a required query parameter"})
		return
	}

	userProjectID := c.GetString(middleware.ProjectIDKey)
	if userProjectID == "" {
		logging.SystemError(ErrProjectIDNotFoundInContext)
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Error: ErrProjectIDNotFoundInContext.Error(), Message: "Authorization error"})
		return
	}

	if userProjectID != projectID {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Message: "User does not have access to project " + projectID})
		return
	}

	destinationIDs := c.Query("destination_ids")
	if destinationIDs == "" {
		destinationsObjects, err := eh.configurationsProvider.GetDestinationsByProjectID(projectID)
		if err != nil {
			logging.Errorf("Error getting destinations for [%s] project: %v", projectID, err)
			c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Error getting destinations for project " + projectID})
			return
		}

		if len(destinationsObjects) == 0 {
			c.JSON(http.StatusOK, enhandlers.CachedEventsResponse{Events: []enhandlers.CachedEvent{}})
			return
		}

		var destinationIDsArray []string
		for _, destinationObject := range destinationsObjects {
			destinationID := projectID + "." + destinationObject.UID
			destinationIDsArray = append(destinationIDsArray, destinationID)
		}

		destinationIDs = strings.Join(destinationIDsArray, ",")
	}

	events, err := eh.enService.GetLastEvents(destinationIDs, start, end, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrorResponse{Message: "Events err", Error: err.Error()})
		return
	}

	logging.Debugf("Last Events response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, events)
}
