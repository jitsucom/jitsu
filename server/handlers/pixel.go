package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/cors"
	"github.com/jitsucom/jitsu/server/multiplexing"
	"github.com/jitsucom/jitsu/server/uuid"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
)

const (
	dataField = "data"

	cookieDomainField = "cookie_domain"
	anonymIDJSONPath  = "/user/anonymous_id||/eventn_ctx/user/anonymous_id"
)

//PixelHandler is a handler of pixel tracking requests
type PixelHandler struct {
	emptyGIF            []byte
	anonymIDPath        jsonutils.JSONPath
	multiplexingService *multiplexing.Service
	processor           events.Processor
}

//NewPixelHandler returns configured PixelHandler instance
func NewPixelHandler(multiplexingService *multiplexing.Service, processor events.Processor) *PixelHandler {
	return &PixelHandler{
		emptyGIF:            appconfig.Instance.EmptyGIFPixelOnexOne,
		anonymIDPath:        jsonutils.NewJSONPath(anonymIDJSONPath),
		multiplexingService: multiplexingService,
		processor:           processor,
	}
}

//Handle sets anonymous id cookie if not exist
//handles request it it another goroutine
//returns empty gif 1x1
func (ph *PixelHandler) Handle(c *gin.Context) {
	event, err := ph.parseEvent(c)
	if err != nil {
		logging.Error(err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	ph.extractOrSetAnonymIDCookie(c, event)

	var strToken string
	token, ok := event[middleware.TokenName]
	if ok {
		strToken = fmt.Sprint(token)
	} else {
		token, ok = event[middleware.APIKeyName]
		if ok {
			strToken = fmt.Sprint(token)
		}
	}

	reqContext := getRequestContext(c)

	err = ph.multiplexingService.AcceptRequest(ph.processor, reqContext, strToken, []events.Event{event})
	if err != nil {
		code := http.StatusBadRequest
		if err == multiplexing.ErrNoDestinations {
			code = http.StatusUnprocessableEntity
			err = fmt.Errorf(noDestinationsErrTemplate, strToken)
		}

		reqBody, _ := json.Marshal(event)
		logging.Errorf("%v. Tracking pixel event: %s", err, string(reqBody))
		c.JSON(code, middleware.ErrResponse(err.Error(), nil))
		return
	}

	c.Data(http.StatusOK, "image/gif", ph.emptyGIF)
}

//parseEvent parses event from query parameters (dataField and json paths)
func (ph *PixelHandler) parseEvent(c *gin.Context) (events.Event, error) {
	parameters := c.Request.URL.Query()
	event := events.Event{}

	data := parameters.Get(dataField)
	if data != "" {
		dataBytes, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			return nil, fmt.Errorf("Error decoding event from %q field in tracking pixel: %v", dataField, err)
		}

		err = json.Unmarshal(dataBytes, &event)
		if err != nil {
			return nil, fmt.Errorf("Error unmarshalling event from %q: %v", dataField, err)
		}
	}

	for key, value := range parameters {
		if key == dataField {
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

	return event, nil
}

//extractOrSetAnonymIDCookie if no anoymous id found:
// 1. gets cookie value (anonym ID)
// 2. generates and set it if doesn't exist
// Note: do nothing if query parameter gdpr=true is provided
func (ph *PixelHandler) extractOrSetAnonymIDCookie(c *gin.Context, event events.Event) {
	if c.Query(middleware.CookieLessQueryParameter) == "true" {
		return
	}

	if anonymID, ok := ph.anonymIDPath.Get(event); ok {
		c.Set(middleware.JitsuAnonymIDCookie, anonymID)
		return
	}

	anonymID, err := c.Cookie(middleware.JitsuAnonymIDCookie)
	if err != nil {
		if err == http.ErrNoCookie {
			anonymID = strings.ReplaceAll(uuid.New(), "-", "")[:10]

			topLevelDomain, ok := event[cookieDomainField]
			if !ok {
				topLevelDomain, _ = cors.ExtractTopLevelAndDomain(c.Request.Host)
			}

			http.SetCookie(c.Writer, &http.Cookie{
				Name:     middleware.JitsuAnonymIDCookie,
				Value:    url.QueryEscape(anonymID),
				Expires:  time.Now().AddDate(1000, 12, 31),
				Path:     "/",
				Domain:   fmt.Sprint(topLevelDomain),
				SameSite: http.SameSiteNoneMode,
				Secure:   true,
				HttpOnly: false,
			})
		} else {
			logging.Errorf("Error extracting cookie %q: %v", middleware.JitsuAnonymIDCookie, err)
		}
	}

	c.Set(middleware.JitsuAnonymIDCookie, anonymID)
}
