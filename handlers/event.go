package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
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

type CachedEventsResponse struct {
	Events []meta.Event `json:"events"`
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

	//put eventn_ctx_event_id if not set (e.g. It is used for ClickHouse)
	eventId := uuid.New()
	events.EnrichWithEventId(payload, eventId)

	tokenId := appconfig.Instance.AuthorizationService.GetTokenId(token)

	if eh.eventsCache != nil {
		for _, proxy := range eh.destinationService.GetStorages(tokenId) {
			destination, ok := proxy.Get()
			if ok {
				eh.eventsCache.PutAsync(destination.Name(), eventId, payload)
			}
		}
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

func (eh *EventHandler) GetHandler(c *gin.Context) {
	start, err := time.Parse(timestamp.Layout, c.Query("start"))
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing start query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
		return
	}
	end, err := time.Parse(timestamp.Layout, c.Query("end"))
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing end query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
		return
	}
	destinationIds := c.Query("destination_ids")
	limitStr := c.Query("limit")
	var limit int
	if limitStr == "" {
		limit = defaultLimit
	} else {
		limit, err = strconv.Atoi(limitStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "limit must be int"})
			return
		}
	}

	response := CachedEventsResponse{Events: []meta.Event{}}
	if len(destinationIds) == 0 {
		//response.Events = eh.eventsCache.GetAll(limit)
	} else {
		for _, destinationId := range strings.Split(destinationIds, ",") {
			response.Events = append(response.Events, eh.eventsCache.GetN(destinationId, start, end, limit)...)
		}
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
