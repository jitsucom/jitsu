package handlers

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/appstatus"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/multiplexing"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/wal"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	defaultLimit = 100

	noDestinationsErrTemplate = "No destination is configured for token [%q] (or only staged ones)"
)

//EventResponse is a dto for sending operation status and delete_cookie flag
type EventResponse struct {
	Status       string `json:"status"`
	DeleteCookie bool   `json:"delete_cookie,omitempty"`
}

//CachedEvent is a dto for events cache
type CachedEvent struct {
	Original      json.RawMessage `json:"original,omitempty"`
	Success       json.RawMessage `json:"success,omitempty"`
	Error         string          `json:"error,omitempty"`
	Skip          string          `json:"skip,omitempty"`
	DestinationID string          `json:"destination_id"`
}

//CachedEventsResponse dto for events cache response
type CachedEventsResponse struct {
	TotalEvents    int           `json:"total_events"`
	ResponseEvents int           `json:"response_events"`
	Events         []CachedEvent `json:"events"`
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

	//get geo resolver
	geoResolver := eh.geoService.GetGlobalGeoResolver()
	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(token)
	destinationStorages := eh.destinationService.GetDestinations(tokenID)
	if len(destinationStorages) > 0 {
		geoResolver = eh.geoService.GetGeoResolver(destinationStorages[0].GetGeoResolverID())
	}

	reqContext := getRequestContext(c, geoResolver, eventsArray...)

	//put all events to write-ahead-log if idle
	if appstatus.Instance.Idle.Load() {
		eh.writeAheadLogService.Consume(eventsArray, reqContext, token, eh.processor.Type())
		c.JSON(http.StatusOK, middleware.OKResponse())
		return
	}

	err = eh.multiplexingService.AcceptRequest(eh.processor, reqContext, token, eventsArray)
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

	c.JSON(http.StatusOK, EventResponse{Status: "ok", DeleteCookie: !reqContext.CookiesLawCompliant})
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

	end := timestamp.Now().UTC()
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
			m := make(map[string]interface{})
			if err := json.Unmarshal([]byte(event.Original), &m); err == nil {
				response.Events = append(response.Events, CachedEvent{
					Original:      []byte(event.Original),
					Success:       []byte(event.Success),
					Error:         event.Error,
					Skip:          event.Skip,
					DestinationID: event.DestinationID,
				})
			}
		}
		response.ResponseEvents += len(eventsArray)
		response.TotalEvents += eh.eventsCache.GetTotal(destinationID)
	}

	c.JSON(http.StatusOK, response)
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

	ip := c.Request.Header.Get("X-Forwarded-For")

	if ip == "" {
		remoteAddr := c.Request.RemoteAddr
		if remoteAddr != "" {
			addrPort := strings.Split(remoteAddr, ":")
			ip = addrPort[0]
		}
	}

	//Case when Nginx concatenate remote_addr to client addr
	if strings.Contains(ip, ",") {
		addresses := strings.Split(ip, ",")
		return strings.TrimSpace(addresses[0])
	}

	return ip
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
