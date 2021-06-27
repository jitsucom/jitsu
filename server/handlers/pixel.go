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
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/timestamp"
)

const TRACKING_PIXEL = "R0lGODlhAQABAIAAAAAAAP8AACH5BAEAAAEALAAAAAABAAEAAAICTAEAOw=="

type PixelHandler struct {
	data []byte

	destinationService *destinations.Service
	eventsCache        *caching.EventsCache
}

func NewPixelHandler(destinationsService *destinations.Service, eventsCache *caching.EventsCache) *PixelHandler {
	var err error
	handler := &PixelHandler{
		destinationService: destinationsService,
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

	enrichEvent(event, c)

	if token != "" {
		handler.sendEvent(token, event)
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

func enrichEvent(event map[string]interface{}, c *gin.Context) {
	compatibility := false
	if _, ok := event["compat"]; ok {
		compatibility = true
	}

	urlField := "url"
	hostField := "doc_host"
	pathField := "doc_path"
	searchField := "doc_search"
	userIdField := "user/anonymous_id"
	agentField := "user_agent"
	timeField := "utc_time"
	if compatibility {
		urlField = "eventn_ctx/url"
		hostField = "eventn_ctx/doc_host"
		pathField = "eventn_ctx/doc_path"
		searchField = "eventn_ctx/doc_search"
		userIdField = "eventn_ctx/user/anonymous_id"
		agentField = "eventn_ctx/user_agent"
		timeField = "eventn_ctx/utc_time"
	}

	path := jsonutils.NewJSONPath(urlField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.RemoteAddr)
	}

	path = jsonutils.NewJSONPath(hostField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.Host)
	}

	path = jsonutils.NewJSONPath(pathField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.URL.Path)
	}

	path = jsonutils.NewJSONPath(searchField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.URL.RawQuery)
	}

	path = jsonutils.NewJSONPath(userIdField)
	if _, exist := path.Get(event); !exist {
		domain, ok := event["cookie_domain"]
		if !ok {
			domain = c.Request.Host
		}

		if domain_str, ok := domain.(string); ok {
			cookie, err := c.Request.Cookie(domain_str)
			if err == nil && cookie != nil {
				path.Set(event, cookie.Value)
			}
		}
	}

	path = jsonutils.NewJSONPath(agentField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.UserAgent())
	}

	path = jsonutils.NewJSONPath(timeField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, timestamp.NowUTC())
	}

	event["src"] = "jitsu_gif"
}

func (handler *PixelHandler) sendEvent(token string, event events.Event) {
	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(token)
	destinationStorages := handler.destinationService.GetDestinations(tokenID)
	if len(destinationStorages) == 0 {
		logging.Debugf(noDestinationsErrTemplate, token)
		return
	}

	// ** Enrichment **
	// Note: we assume that destinations under 1 token can't have different unique ID configuration (JS SDK 2.0 or an old one)
	// enrichment.ContextEnrichmentStep(payload, token, c.Request, eh.processor, destinationStorages[0].GetUniqueIDField())

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

	// Retrospective users recognition
	// handler.processor.Postprocess(event, eventID, destinationIDs)

	// ** Telemetry **
	counters.SuccessSourceEvents(tokenID, 1)
}
