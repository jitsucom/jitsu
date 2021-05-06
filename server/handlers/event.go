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
	"github.com/jitsucom/jitsu/server/timestamp"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	defaultLimit              = 100
	noDestinationsErrTemplate = "No destination is configured for token [%s] (or only staged ones)"
)

//CachedEvent dto for events cache
type CachedEvent struct {
	Original json.RawMessage `json:"original,omitempty"`
	Success  json.RawMessage `json:"success,omitempty"`
	Error    string          `json:"error,omitempty"`
}

//CachedEventsResponse dto for events cache response
type CachedEventsResponse struct {
	TotalEvents    int           `json:"total_events"`
	ResponseEvents int           `json:"response_events"`
	Events         []CachedEvent `json:"events"`
}

//EventHandler accepts all events
type EventHandler struct {
	destinationService *destinations.Service
	processor          events.Processor
	eventsCache        *caching.EventsCache
}

//NewEventHandler returns configured EventHandler
func NewEventHandler(destinationService *destinations.Service, processor events.Processor, eventsCache *caching.EventsCache) (eventHandler *EventHandler) {
	return &EventHandler{
		destinationService: destinationService,
		processor:          processor,
		eventsCache:        eventsCache,
	}
}

//PostHandler accepts all events according to token
func (eh *EventHandler) PostHandler(c *gin.Context) {
	payload := events.Event{}
	if err := c.BindJSON(&payload); err != nil {
		logging.Errorf("Error parsing event body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}

	iface, ok := c.Get(middleware.TokenName)
	if !ok {
		logging.SystemError("Token wasn't found in the context")
		return
	}
	token := iface.(string)

	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(token)
	destinationStorages := eh.destinationService.GetDestinations(tokenID)
	if len(destinationStorages) == 0 {
		noConsumerMessage := fmt.Sprintf(noDestinationsErrTemplate, token)
		logging.Warnf("%s. Event: %s", noConsumerMessage, payload.Serialize())
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(noConsumerMessage, nil))
		return
	}

	//** Context enrichment **
	//Note: we assume that destinations under 1 token can't have different unique ID configuration (JS SDK 2.0 or an old one)
	enrichment.ContextEnrichmentStep(payload, token, c.Request, eh.processor, destinationStorages[0].GetUniqueIDField())

	//** Caching **
	//clone payload for preventing concurrent changes while serialization
	cachingEvent := payload.Clone()

	//Persisted cache
	//extract unique identifier
	eventID := destinationStorages[0].GetUniqueIDField().Extract(payload)
	if eventID == "" {
		logging.SystemErrorf("[%s] Empty extracted unique identifier in: %s", destinationStorages[0].ID(), payload.Serialize())
	}
	var destinationIDs []string
	for _, destinationProxy := range destinationStorages {
		destinationIDs = append(destinationIDs, destinationProxy.ID())
		eh.eventsCache.Put(destinationProxy.IsCachingDisabled(), destinationProxy.ID(), eventID, cachingEvent)
	}

	//** Multiplexing **
	consumers := eh.destinationService.GetConsumers(tokenID)
	if len(consumers) == 0 {
		noConsumerMessage := fmt.Sprintf(noDestinationsErrTemplate, token)
		logging.Warnf("%s. Event: %s", noConsumerMessage, payload.Serialize())
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(noConsumerMessage, nil))
		return
	}

	for _, consumer := range consumers {
		consumer.Consume(payload, tokenID)
	}

	//Retrospective users recognition
	eh.processor.Postprocess(payload, eventID, destinationIDs)

	counters.SuccessSourceEvents(tokenID, 1)

	c.JSON(http.StatusOK, middleware.OKResponse())
}

func (eh *EventHandler) GetHandler(c *gin.Context) {
	var err error
	destinationIDs, ok := c.GetQuery("destination_ids")
	if !ok {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("destination_ids is required parameter", nil))
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
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing start query parameter. Accepted datetime format: "+timestamp.Layout, err))
			return
		}
	}

	end := time.Now().UTC()
	endStr := c.Query("end")
	if endStr != "" {
		end, err = time.Parse(time.RFC3339Nano, endStr)
		if err != nil {
			logging.Errorf("Error parsing end query param [%s] in events cache handler: %v", endStr, err)
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing end query parameter. Accepted datetime format: "+timestamp.Layout, err))
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
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("limit must be int", nil))
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
