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

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
)

const (
	dataField = "data"

	cookieDomainField = "cookie_domain"
)

//PixelHandler is a handler of pixel tracking requests
type PixelHandler struct {
	emptyGIF []byte

	multiplexingService *multiplexing.Service
	processor           events.Processor
}

//NewPixelHandler returns configured PixelHandler instance
func NewPixelHandler(multiplexingService *multiplexing.Service, processor events.Processor) *PixelHandler {
	return &PixelHandler{
		emptyGIF:            appconfig.Instance.EmptyGIFPixelOnexOne,
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
	} else {
		ph.extractOrSetAnonymID(c, event)

		token, ok := event[middleware.TokenName]
		if !ok {
			token, _ = event[middleware.APIKeyName]
		}

		err = ph.multiplexingService.AcceptRequest(ph.processor, c, fmt.Sprint(token), []events.Event{event})
		if err != nil {
			reqBody, _ := json.Marshal(event)
			logging.Warnf("%v. Tracking pixel event: %s", err, string(reqBody))
		}
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

//extractOrSetAnonymID gets cookie value (anonym ID)
//generates and set it if doesn't exist
func (ph *PixelHandler) extractOrSetAnonymID(c *gin.Context, event events.Event) {
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
				MaxAge:   0,
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
