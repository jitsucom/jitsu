package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
)

const TRACKING_PIXEL = "R0lGODlhAQABAIAAAAAAAP8AACH5BAEAAAEALAAAAAABAAEAAAICTAEAOw=="

type PixelHandler struct {
	data []byte

	destinationService *destinations.Service
	processor          events.Processor
	eventsCache        *caching.EventsCache
}

func NewPixelHandler(destinationsService *destinations.Service, processor events.Processor, eventsCache *caching.EventsCache) *PixelHandler {
	var err error
	handler := &PixelHandler{
		destinationService: destinationsService,
		processor:          processor,
		eventsCache:        eventsCache,
	}

	handler.data, err = base64.StdEncoding.DecodeString(TRACKING_PIXEL)
	if err != nil {
		logging.Warnf("Cannot decode image for tracking pixel: %v", err)
	}

	return handler
}

func (handler *PixelHandler) Handle(c *gin.Context) {
	go handler.doTracking(c.Copy())

	c.Data(http.StatusOK, "image/gif", handler.data)
}

func (handler *PixelHandler) doTracking(c *gin.Context) {
	event := map[string]interface{}{}

	token := restoreEvent(event, c)

	if token != "" {
		handler.sendEvent(token, event, c.Request)
	}
}

func restoreEvent(event events.Event, c *gin.Context) string {
	parameters := c.Request.URL.Query()

	data := parameters.Get("data")
	if data != "" {
		value, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			logging.Debugf("Error decoding string: %v", err)
		} else {
			err = json.Unmarshal(value, &event)
			if err != nil {
				logging.Debugf("Error parsing JSON event: %v", err)
			}
		}
	}

	for key, value := range parameters {
		if key == "data" {
			continue
		}

		converted := strings.ReplaceAll(key, ".", "/")
		path := jsonutils.NewJSONPath(converted)
		if len(value) == 1 {
			path.Set(event, value[0])
		} else {
			path.Set(event, value)
		}
	}

	return fmt.Sprint(event[middleware.TokenName])
}

func (handler *PixelHandler) sendEvent(token string, event events.Event, request *http.Request) {
	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(token)
	destinationStorages := handler.destinationService.GetDestinations(tokenID)
	if len(destinationStorages) == 0 {
		logging.Debugf(noDestinationsErrTemplate, token)
		return
	}

	// ** Enrichment **
	// Note: we assume that destinations under 1 token can't have different unique ID configuration (JS SDK 2.0 or an old one)
	enrichment.ContextEnrichmentStep(event, token, request, handler.processor, destinationStorages[0].GetUniqueIDField())

	// ** Caching **
	// Clone event for preventing concurrent changes while serialization
	cachingEvent := event.Clone()

	// Extract unique identifier
	eventID := destinationStorages[0].GetUniqueIDField().Extract(event)
	if eventID == "" {
		logging.Debugf("[%s] Empty extracted unique identifier in: %s", destinationStorages[0].ID(), event.Serialize())
	}

	var destinationIDs []string
	for _, destinationProxy := range destinationStorages {
		destinationIDs = append(destinationIDs, destinationProxy.ID())
		handler.eventsCache.Put(destinationProxy.IsCachingDisabled(), destinationProxy.ID(), eventID, cachingEvent)
	}

	// ** Multiplexing **
	consumers := handler.destinationService.GetConsumers(tokenID)
	if len(consumers) == 0 {
		logging.Debugf(noDestinationsErrTemplate, token)
		return
	}

	for _, consumer := range consumers {
		consumer.Consume(event, tokenID)
	}

	// ** Postprocessing **
	handler.processor.Postprocess(event, eventID, destinationIDs)

	// ** Telemetry **
	counters.SuccessSourceEvents(tokenID, 1)
}
