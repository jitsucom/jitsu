package handlers

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/appstatus"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/multiplexing"
	"github.com/jitsucom/jitsu/server/wal"
)

const (
	defaultLimit = 100

	noDestinationsErrTemplate = "No destination is configured for token [%q] (or only staged ones)"
)

//EventResponse is a dto for sending operation status and delete_cookie flag
type EventResponse struct {
	Status       string                   `json:"status"`
	DeleteCookie bool                     `json:"delete_cookie,omitempty"`
	SdkExtras    []map[string]interface{} `json:"jitsu_sdk_extras,omitempty"`
}

//CachedEvent is a dto for events cache
type CachedEvent struct {
	Malformed     string          `json:"malformed,omitempty"`
	Original      json.RawMessage `json:"original,omitempty"`
	Success       json.RawMessage `json:"success,omitempty"`
	Error         string          `json:"error,omitempty"`
	Skip          string          `json:"skip,omitempty"`
	Timestamp     string          `json:"timestamp,omitempty"`
	UID           string          `json:"uid,omitempty"`
	DestinationID string          `json:"destination_id"`
	TokenID       string          `json:"token_id"`
}

//CachedEventsResponse dto for events cache response
type CachedEventsResponse struct {
	TotalEvents              int           `json:"total_events"`
	LastMinuteLimited        uint64        `json:"last_minute_limited"`
	CacheCapacityPerInterval int           `json:"cache_capacity_per_interval"`
	IntervalSeconds          int           `json:"interval_seconds"`
	ResponseEvents           int           `json:"response_events"`
	Events                   []CachedEvent `json:"events"`
}

//EventHandler accepts all events
type EventHandler struct {
	writeAheadLogService *wal.Service
	multiplexingService  *multiplexing.Service
	eventsCache          *caching.EventsCache
	parser               events.Parser
	processor            events.Processor
	destinationService   *destinations.Service
	geoService           *geo.Service
}

//NewEventHandler returns configured EventHandler
func NewEventHandler(writeAheadLogService *wal.Service, multiplexingService *multiplexing.Service,
	eventsCache *caching.EventsCache, parser events.Parser, processor events.Processor, destinationService *destinations.Service,
	geoService *geo.Service) (eventHandler *EventHandler) {
	return &EventHandler{
		writeAheadLogService: writeAheadLogService,
		multiplexingService:  multiplexingService,
		eventsCache:          eventsCache,
		parser:               parser,
		processor:            processor,
		destinationService:   destinationService,
		geoService:           geoService,
	}
}

//PostHandler accepts all events according to token
func (eh *EventHandler) PostHandler(c *gin.Context) {
	iface, ok := c.Get(middleware.TokenName)
	if !ok {
		logging.SystemError("Token wasn't found in the context")
		return
	}
	token := iface.(string)
	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(token)
	destinationStorages := eh.destinationService.GetDestinations(tokenID)

	cachingDisabled := false
	for _, destinationStorage := range destinationStorages {
		if destinationStorage.IsCachingDisabled() {
			cachingDisabled = true
			break
		}
	}

	eventsArray, parsingErr := eh.parser.ParseEventsBody(c)
	if parsingErr != nil {
		eh.eventsCache.RawErrorEvent(cachingDisabled, tokenID, parsingErr.LimitedPayload, parsingErr.Err)
		msg := fmt.Sprintf("Error parsing events body: %v", parsingErr.Err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(msg, nil))
		return
	}

	if appconfig.Instance.EnrichWithHTTPContext {
		headers := make(http.Header)
		for key, values := range c.Request.Header {
			headers[strings.ToLower(key)] = values
		}

		for _, event := range eventsArray {
			event[events.HTTPContextField] = &events.HTTPContext{
				Headers: headers,
			}
		}
	}

	//get geo resolver
	geoResolver := eh.geoService.GetGlobalGeoResolver()
	if len(destinationStorages) > 0 {
		geoResolver = eh.geoService.GetGeoResolver(destinationStorages[0].GetGeoResolverID())
	}

	reqContext := getRequestContext(c, geoResolver, eventsArray...)

	//put all events to write-ahead-log if idle
	if appstatus.Instance.Idle.Load() {
		eh.CacheRawEvents(eventsArray, cachingDisabled, tokenID, nil, nil)
		eh.writeAheadLogService.Consume(eventsArray, reqContext, token, eh.processor.Type())
		c.JSON(http.StatusOK, middleware.OKResponse())
		return
	}

	extras, err := eh.multiplexingService.AcceptRequest(eh.processor, reqContext, token, eventsArray)
	if err != nil {
		code := http.StatusBadRequest
		if err == multiplexing.ErrNoDestinations {
			code = http.StatusUnprocessableEntity
			err = fmt.Errorf(noDestinationsErrTemplate, token)
			eh.CacheRawEvents(eventsArray, cachingDisabled, tokenID, err, nil)
		} else {
			eh.CacheRawEvents(eventsArray, cachingDisabled, tokenID, nil, err)
		}

		reqBody, _ := json.Marshal(eventsArray)
		logging.Warnf("%v. Event: %s", err, string(reqBody))
		c.JSON(code, middleware.ErrResponse(err.Error(), nil))
		return
	} else {
		eh.CacheRawEvents(eventsArray, cachingDisabled, tokenID, nil, nil)
	}

	c.JSON(http.StatusOK, EventResponse{Status: "ok", DeleteCookie: !reqContext.CookiesLawCompliant, SdkExtras: extras})
}

//GetHandler returns cached events by destination_ids
func (eh *EventHandler) GetHandler(c *gin.Context) {
	var err error
	ids, ok := c.GetQuery("ids")
	if !ok {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("ids is required parameter", nil))
		return
	}

	if ids == "" {
		c.JSON(http.StatusOK, CachedEventsResponse{Events: []CachedEvent{}})
		return
	}

	namespace, ok := c.GetQuery("namespace")
	if !ok || namespace == "" {
		namespace = meta.EventsDestinationNamespace
	}

	if namespace != meta.EventsDestinationNamespace && namespace != meta.EventsTokenNamespace {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(fmt.Sprintf("namespace query parameter can be only 'token' or 'destination'. Current value: %s", namespace), nil))
		return
	}

	status := c.Query("status")
	if status != "" && status != meta.EventsErrorStatus {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(fmt.Sprintf("status query parameter can be only %q or not specified. Current value: %s", meta.EventsErrorStatus, status), nil))
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
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("limit must be int", nil))
			return
		}
	}

	cacheCapacity, intervalSeconds := eh.eventsCache.GetCacheCapacityAndIntervalWindow()
	response := CachedEventsResponse{
		Events:                   []CachedEvent{},
		CacheCapacityPerInterval: cacheCapacity,
		IntervalSeconds:          intervalSeconds,
	}
	for _, id := range strings.Split(ids, ",") {
		eventsArray, lastMinuteLimited := eh.eventsCache.Get(namespace, id, status, limit)
		for _, event := range eventsArray {
			response.Events = append(response.Events, CachedEvent{
				Original:      []byte(event.Original),
				Success:       []byte(event.Success),
				Malformed:     event.Malformed,
				Error:         event.Error,
				Skip:          event.Skip,
				Timestamp:     event.Timestamp,
				UID:           event.UID,
				DestinationID: event.DestinationID,
				TokenID:       event.TokenID,
			})
		}
		response.ResponseEvents += len(eventsArray)
		response.LastMinuteLimited += lastMinuteLimited
		response.TotalEvents += eh.eventsCache.GetTotal(namespace, id, status)
	}

	c.JSON(http.StatusOK, response)
}

func (eh *EventHandler) CacheRawEvents(eventsArray []events.Event, cachingDisabled bool, tokenID string, skip error, err error) {
	for _, e := range eventsArray {
		serializedPayload, _ := json.Marshal(e)
		if err != nil {
			eh.eventsCache.RawErrorEvent(cachingDisabled, tokenID, serializedPayload, err)
			return
		}

		skipMsg := ""
		if skip != nil {
			skipMsg = skip.Error()
		}
		eh.eventsCache.RawEvent(cachingDisabled, tokenID, serializedPayload, skipMsg)
	}
}

//extractIP returns client IP from input events or if no one has - parses from HTTP request (headers, remoteAddr)
func extractIP(c *gin.Context, eventPayloads ...events.Event) string {
	for _, e := range eventPayloads {
		if ip, ok := e[enrichment.IPKey]; ok {
			if ipStr, ok := ip.(string); ok {
				return ipStr
			}
		}
	}

	return middleware.ExtractIP(c)
}

func getRequestContext(c *gin.Context, geoResolver geo.Resolver, eventPayloads ...events.Event) *events.RequestContext {
	clientIP := extractIP(c, eventPayloads...)
	var compliant *bool
	cookiesLawCompliant := true

	//cookies
	cookiePolicy := c.Query(middleware.CookiePolicyParameter)
	if cookiePolicy != "" {
		switch cookiePolicy {
		case middleware.ComplyValue:
			value := complyWithCookieLaws(geoResolver, clientIP)
			compliant = &value
			cookiesLawCompliant = value
		case middleware.KeepValue:
			cookiesLawCompliant = true
		case middleware.StrictValue:
			cookiesLawCompliant = false
		default:
			logging.SystemErrorf("Unknown value %q for %q query parameter", middleware.CookiePolicyParameter, cookiePolicy)
		}
	}
	hashedAnonymousID := fmt.Sprintf("%x", md5.Sum([]byte(clientIP+c.Request.UserAgent())))

	var jitsuAnonymousID string
	if !cookiesLawCompliant {
		//cookie less
		jitsuAnonymousID = hashedAnonymousID
	}

	//ip address
	ipPolicy := c.Query(middleware.IPPolicyParameter)
	if ipPolicy != "" {
		switch ipPolicy {
		case middleware.ComplyValue:
			if compliant == nil {
				value := complyWithCookieLaws(geoResolver, clientIP)
				compliant = &value
			}

			if !*compliant {
				clientIP = getThreeOctets(clientIP)
			}
		case middleware.KeepValue:
		case middleware.StrictValue:
			clientIP = getThreeOctets(clientIP)
		default:
			logging.SystemErrorf("Unknown value %q for %q query parameter", middleware.IPPolicyParameter, ipPolicy)
		}
	}

	return &events.RequestContext{
		UserAgent:           c.Request.UserAgent(),
		ClientIP:            clientIP,
		Referer:             c.Request.Referer(),
		JitsuAnonymousID:    jitsuAnonymousID,
		HashedAnonymousID:   hashedAnonymousID,
		CookiesLawCompliant: cookiesLawCompliant,
	}
}

func getThreeOctets(ip string) string {
	ipParts := strings.Split(ip, ".")
	ipParts[len(ipParts)-1] = "1"
	return strings.Join(ipParts, ".")
}

//complyWithCookieLaws returns true if geo data has been detected and ip isn't from EU or UK
func complyWithCookieLaws(geoResolver geo.Resolver, ip string) bool {
	ipThreeOctets := getThreeOctets(ip)

	if geoResolver.Type() != geo.MaxmindType {
		return false
	}

	data, err := geoResolver.Resolve(ipThreeOctets)
	if err != nil {
		logging.SystemErrorf("complying failed to resolve IP %q into geo data: %v", ipThreeOctets, err)
		return false
	}

	if _, ok := geo.EUCountries[data.Country]; ok || data.Country == geo.UKCountry {
		return false
	}

	return true
}
