package handlers

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/middleware"
	"github.com/jitsucom/eventnative/telemetry"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/uuid"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	apiTokenKey  = "api_key"
	ipKey        = "source_ip"
	defaultLimit = 100
)

type CachedEvent struct {
	Original json.RawMessage `json:"original,omitempty"`
	Success  json.RawMessage `json:"success,omitempty"`
	Error    string          `json:"error,omitempty"`
}

type OldCachedEventsResponse struct {
	Events []events.Fact `json:"events"`
}

type CachedEventsResponse struct {
	TotalEvents    int           `json:"total_events"`
	ResponseEvents int           `json:"response_events"`
	Events         []CachedEvent `json:"events"`
}

//Accept all events
type EventHandler struct {
	destinationService  *destinations.Service
	preprocessor        events.Preprocessor
	eventsCache         *caching.EventsCache
	inMemoryEventsCache *events.Cache
}

//Accept all events according to token
func NewEventHandler(destinationService *destinations.Service, preprocessor events.Preprocessor, eventsCache *caching.EventsCache,
	inMemoryEventsCache *events.Cache) (eventHandler *EventHandler) {
	return &EventHandler{
		destinationService:  destinationService,
		preprocessor:        preprocessor,
		eventsCache:         eventsCache,
		inMemoryEventsCache: inMemoryEventsCache,
	}
}

func (eh *EventHandler) PostHandler(c *gin.Context) {
	payload := events.Fact{}
	if err := c.BindJSON(&payload); err != nil {
		logging.Error("Error parsing event body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err.Error()})
		return
	}

	iface, ok := c.Get(middleware.TokenName)
	if !ok {
		logging.SystemError("Token wasn't found in context")
		return
	}
	token := iface.(string)

	//Deprecated
	eh.inMemoryEventsCache.PutAsync(token, payload)

	//put eventn_ctx_event_id if not set (e.g. It is used for ClickHouse)
	events.EnrichWithEventId(payload, uuid.New())
	//get eventId if it is in request
	eventId := events.ExtractEventId(payload)

	tokenId := appconfig.Instance.AuthorizationService.GetTokenId(token)

	//caching
	for destinationId := range eh.destinationService.GetDestinationIds(tokenId) {
		//clone payload map for preventing concurrent changes while serialization
		eh.eventsCache.Put(destinationId, eventId, payload.Clone())
	}

	ip := extractIp(c.Request)
	if ip != "" {
		payload[ipKey] = ip
	}

	processed, err := eh.preprocessor.Preprocess(payload)
	if err != nil {
		logging.Error("Error processing event:", err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error processing event", Error: err.Error()})
		return
	}

	processed[apiTokenKey] = token
	processed[timestamp.Key] = timestamp.NowUTC()

	consumers := eh.destinationService.GetConsumers(tokenId)
	if len(consumers) == 0 {
		logging.Warnf("Unknown token[%s] request was received", token)
	} else {
		telemetry.Event()

		for _, consumer := range consumers {
			consumer.Consume(processed, tokenId)
		}
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

	response := OldCachedEventsResponse{Events: []events.Fact{}}
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
	destinationIds := c.Query("destination_ids")
	if destinationIds == "" {
		logging.Errorf("Empty destination ids in events cache handler")
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "destination_ids is required parameter."})
		return
	}

	startStr := c.Query("start")
	start, err := time.Parse(timestamp.Layout, startStr)
	if err != nil {
		logging.Errorf("Error parsing start query param [%s] in events cache handler: %v", startStr, err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing start query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
		return
	}

	endStr := c.Query("end")
	end, err := time.Parse(timestamp.Layout, endStr)
	if err != nil {
		logging.Errorf("Error parsing end query param [%s] in events cache handler: %v", endStr, err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing end query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
		return
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

func extractIp(r *http.Request) string {
	ip := r.Header.Get("X-Real-IP")
	if ip == "" {
		ip = r.Header.Get("X-Forwarded-For")
	}
	if ip == "" {
		remoteAddr := r.RemoteAddr
		if remoteAddr != "" {
			addrPort := strings.Split(remoteAddr, ":")
			ip = addrPort[0]
		}
	}
	return ip
}
