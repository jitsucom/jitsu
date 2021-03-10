package handlers

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/enrichment"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/middleware"
	"github.com/jitsucom/eventnative/telemetry"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/users"
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
	inMemoryEventsCache    *events.Cache
	userRecognitionService *users.RecognitionService
}

//Accept all events according to token
func NewEventHandler(destinationService *destinations.Service, preprocessor events.Preprocessor, eventsCache *caching.EventsCache,
	inMemoryEventsCache *events.Cache, userRecognitionService *users.RecognitionService) (eventHandler *EventHandler) {
	return &EventHandler{
		destinationService:     destinationService,
		preprocessor:           preprocessor,
		eventsCache:            eventsCache,
		inMemoryEventsCache:    inMemoryEventsCache,
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

	//Deprecated cache
	eh.inMemoryEventsCache.PutAsync(token, cachingEvent)

	//Persisted cache
	eventId := events.ExtractEventId(payload)
	if eventId == "" {
		logging.SystemErrorf("Empty extracted eventn_ctx_event_id in: %s", payload.Serialize())
	}
	tokenId := appconfig.Instance.AuthorizationService.GetTokenId(token)
	var destinationIds []string
	for destinationId := range eh.destinationService.GetDestinationIds(tokenId) {
		destinationIds = append(destinationIds, destinationId)
		eh.eventsCache.Put(destinationId, eventId, cachingEvent)
	}

	//** Multiplexing **
	consumers := eh.destinationService.GetConsumers(tokenId)
	if len(consumers) == 0 {
		noConsumerMessage := fmt.Sprintf("No destination is configured for token [%s] (or only staged ones)", token)
		logging.Warnf("%s. Event: %s", noConsumerMessage, payload.Serialize())
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: noConsumerMessage})
		return
	} else {
		telemetry.Event()

		for _, consumer := range consumers {
			consumer.Consume(payload, tokenId)
		}

		//Retrospective users recognition
		eh.userRecognitionService.Event(payload, destinationIds)
	}

	c.JSON(http.StatusOK, middleware.OkResponse())
}

func (eh *EventHandler) OldGetHandler(c *gin.Context) {
	apikeys := c.Query("apikeys")
	limitStr := c.Query("limit_per_apikey")
	var limit int
	var err error
	if limitStr == "" {
		limit = defaultLimit
	} else {
		limit, err = strconv.Atoi(limitStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "limit_per_apikey must be int"})
			return
		}
	}

	response := OldCachedEventsResponse{Events: []events.Event{}}
	if len(apikeys) == 0 {
		response.Events = eh.inMemoryEventsCache.GetAll(limit)
	} else {
		for _, key := range strings.Split(apikeys, ",") {
			response.Events = append(response.Events, eh.inMemoryEventsCache.GetN(key, limit)...)
		}
	}

	c.JSON(http.StatusOK, response)
}

func (eh *EventHandler) GetHandler(c *gin.Context) {
	var err error
	destinationIds := c.Query("destination_ids")
	if destinationIds == "" {
		logging.Errorf("Empty destination ids in events cache handler")
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "destination_ids is required parameter."})
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
	for _, destinationId := range strings.Split(destinationIds, ",") {
		eventsArray := eh.eventsCache.GetN(destinationId, start, end, limit)
		for _, event := range eventsArray {
			response.Events = append(response.Events, CachedEvent{
				Original: []byte(event.Original),
				Success:  []byte(event.Success),
				Error:    event.Error,
			})
		}
		response.ResponseEvents += len(eventsArray)
		response.TotalEvents += eh.eventsCache.GetTotal(destinationId)
	}

	c.JSON(http.StatusOK, response)
}
