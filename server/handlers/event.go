package handlers

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/multiplexing"
	"github.com/jitsucom/jitsu/server/timestamp"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	defaultLimit = 100

	noDestinationsErrTemplate = "No destination is configured for token [%q] (or only staged ones)"
)

//CachedEvent is a dto for events cache
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
	multiplexingService *multiplexing.Service
	eventsCache         *caching.EventsCache
	parser              events.Parser
	processor           events.Processor
}

//NewEventHandler returns configured EventHandler
func NewEventHandler(multiplexingService *multiplexing.Service, eventsCache *caching.EventsCache,
	parser events.Parser, processor events.Processor) (eventHandler *EventHandler) {
	return &EventHandler{
		multiplexingService: multiplexingService,
		eventsCache:         eventsCache,
		parser:              parser,
		processor:           processor,
	}
}

//PostHandler accepts all events according to token
func (eh *EventHandler) PostHandler(c *gin.Context) {
	eventsArray, err := eh.parser.ParseEventsBody(c)
	if err != nil {
		msg := fmt.Sprintf("Error parsing events body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(msg, nil))
		return
	}

	iface, ok := c.Get(middleware.TokenName)
	if !ok {
		logging.SystemError("Token wasn't found in the context")
		return
	}
	token := iface.(string)

	err = eh.multiplexingService.AcceptRequest(eh.processor, c, token, eventsArray)
	if err != nil {
		code := http.StatusBadRequest
		if err == multiplexing.ErrNoDestinations {
			code = http.StatusUnprocessableEntity
			err = fmt.Errorf(noDestinationsErrTemplate, token)
		}

		reqBody, _ := json.Marshal(eventsArray)
		logging.Warnf("%v. Event: %s", err, string(reqBody))
		c.JSON(code, middleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, middleware.OKResponse())
}

//GetHandler returns cached events by destination_ids
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
