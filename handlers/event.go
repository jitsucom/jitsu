package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/destinations"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/middleware"
	"github.com/ksensehq/eventnative/telemetry"
	"github.com/ksensehq/eventnative/timestamp"
	"net/http"
	"strconv"
	"strings"
)

const apiTokenKey = "api_key"
const defaultLimit = 100

type CachedEventsResponse struct {
	Events []events.Fact `json:"events"`
}

type StatusResponse struct {
	Status string `json:"status"`
}

//Accept all events
type EventHandler struct {
	destinationService *destinations.Service
	preprocessor       events.Preprocessor
	eventsCache        *events.Cache
}

//Accept all events according to token
func NewEventHandler(destinationService *destinations.Service, preprocessor events.Preprocessor, eventsCache *events.Cache) (eventHandler *EventHandler) {
	return &EventHandler{
		destinationService: destinationService,
		preprocessor:       preprocessor,
		eventsCache:        eventsCache,
	}
}

func (eh *EventHandler) PostHandler(c *gin.Context) {
	payload := events.Fact{}
	if err := c.BindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err})
		return
	}

	iface, ok := c.Get(middleware.TokenName)
	if !ok {
		logging.Error("System error: token wasn't found in context")
		return
	}
	token := iface.(string)

	eh.eventsCache.PutAsync(token, payload)

	processed, err := eh.preprocessor.Preprocess(payload, c.Request)
	if err != nil {
		logging.Error("Error processing event:", err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error processing event", Error: err})
		return
	}

	processed[apiTokenKey] = token
	processed[timestamp.Key] = timestamp.NowUTC()

	tokenId := appconfig.Instance.AuthorizationService.GetTokenId(token)

	consumers := eh.destinationService.GetConsumers(tokenId)
	if len(consumers) == 0 {
		logging.Warnf("Unknown token[%s] request was received", token)
	} else {
		telemetry.Event()

		for _, consumer := range consumers {
			consumer.Consume(processed, tokenId)
		}
	}

	c.JSON(http.StatusOK, StatusResponse{Status: "ok"})
}

func (eh *EventHandler) GetHandler(c *gin.Context) {
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

	response := CachedEventsResponse{Events: []events.Fact{}}
	if len(apikeys) == 0 {
		response.Events = eh.eventsCache.GetAll(limit)
	} else {
		for _, key := range strings.Split(apikeys, ",") {
			response.Events = append(response.Events, eh.eventsCache.GetN(key, limit)...)
		}
	}

	c.JSON(http.StatusOK, response)
}
