package handlers

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/users"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	defaultLimit = 100
)

type CachedEvent struct {
	Original json.RawMessage `json:"original,omitempty"`
	Success  json.RawMessage `json:"success,omitempty"`
	Error    string          `json:"error,omitempty"`
}

type OldCachedEventsResponse struct {
	Events []events.Event `json:"events"`
}

type CachedEventsResponse struct {
	TotalEvents    int           `json:"total_events"`
	ResponseEvents int           `json:"response_events"`
	Events         []CachedEvent `json:"events"`
}

//Accept all events
type EventHandler struct {
	destinationService     *destinations.Service
	preprocessor           events.Preprocessor
	eventsCache            *caching.EventsCache
	userRecognitionService *users.RecognitionService
}

//Accept all events according to token
func NewEventHandler(destinationService *destinations.Service, preprocessor events.Preprocessor, eventsCache *caching.EventsCache,
	userRecognitionService *users.RecognitionService) (eventHandler *EventHandler) {
	return &EventHandler{
		destinationService:     destinationService,
		preprocessor:           preprocessor,
		eventsCache:            eventsCache,
		userRecognitionService: userRecognitionService,
	}
}

func (eh *EventHandler) PostHandler(c *gin.Context) {
	payload := events.Event{}
	if err := c.BindJSON(&payload); err != nil {
		logging.Errorf("Error parsing event body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err.Error()})
		return
	}

	iface, ok := c.Get(middleware.TokenName)
	if !ok {
		logging.SystemError("Token wasn't found in context")
		return
	}
	token := iface.(string)

	//** Context enrichment **
	enrichment.ContextEnrichmentStep(payload, token, c.Request, eh.preprocessor)

	//** Caching **
	//clone payload for preventing concurrent changes while serialization
	cachingEvent := payload.Clone()

	//Persisted cache
	eventID := events.ExtractEventID(payload)
	if eventID == "" {
		logging.SystemErrorf("Empty extracted eventn_ctx_event_id in: %s", payload.Serialize())
	}
	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(token)
	var destinationIDs []string
	for destinationID := range eh.destinationService.GetDestinationIDs(tokenID) {
		destinationIDs = append(destinationIDs, destinationID)
		eh.eventsCache.Put(destinationID, eventID, cachingEvent)
	}

	//** Multiplexing **
	consumers := eh.destinationService.GetConsumers(tokenID)
	if len(consumers) == 0 {
		noConsumerMessage := fmt.Sprintf("No destination is configured for token [%s] (or only staged ones)", token)
		logging.Warnf("%s. Event: %s", noConsumerMessage, payload.Serialize())
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: noConsumerMessage})
		return
	} else {
		telemetry.Event()

		for _, consumer := range consumers {
			consumer.Consume(payload, tokenID)
		}

		//Retrospective users recognition
		eh.userRecognitionService.Event(payload, destinationIDs)

		counters.SuccessSourceEvents(tokenID, 1)
	}

	c.JSON(http.StatusOK, middleware.OkResponse())
}

func (eh *EventHandler) GetHandler(c *gin.Context) {
	var err error
	destinationIDs, ok := c.GetQuery("destination_ids")
	if !ok {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "destination_ids is required parameter."})
		return
	}

	if destinationIDs == "" {
		c.JSON(http.StatusOK, CachedEventsResponse{Events: []CachedEvent{}})
		return
	}

	start := time.Time{}
	startStr := c.Query("start")
	if startStr != "" {
		start, err = time.Parse(time.RFC3339Nano, startStr)
		if err != nil {
			logging.Errorf("Error parsing start query param [%s] in events cache handler: %v", startStr, err)
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing start query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
			return
		}
	}

	end := time.Now().UTC()
	endStr := c.Query("end")
	if endStr != "" {
		end, err = time.Parse(time.RFC3339Nano, endStr)
		if err != nil {
			logging.Errorf("Error parsing end query param [%s] in events cache handler: %v", endStr, err)
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing end query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
			return
		}
	}

	limitStr := c.Query("limit")
	var limit int
	if limitStr == "" {
		limit = defaultLimit
	} else {
		limit, err = strconv.Atoi(limitStr)
		if err != nil {
			logging.Errorf("Error parsing limit [%s] to int in events cache handler: %v", limitStr, err)
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "limit must be int"})
			return
		}
	}

	response := CachedEventsResponse{Events: []CachedEvent{}}
	for _, destinationID := range strings.Split(destinationIDs, ",") {
		eventsArray := eh.eventsCache.GetN(destinationID, start, end, limit)
		for _, event := range eventsArray {
			response.Events = append(response.Events, CachedEvent{
				Original: []byte(event.Original),
				Success:  []byte(event.Success),
				Error:    event.Error,
			})
		}
		response.ResponseEvents += len(eventsArray)
		response.TotalEvents += eh.eventsCache.GetTotal(destinationID)
	}

	c.JSON(http.StatusOK, response)
}
