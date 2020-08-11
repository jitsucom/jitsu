package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/geo"
	"github.com/ksensehq/eventnative/middleware"
	"github.com/ksensehq/eventnative/timestamp"
	"github.com/ksensehq/eventnative/useragent"
	"log"
	"net/http"
	"strings"
	"time"
)

const eventnKey = "eventn_ctx"
const uaKey = "user_agent"

//Accept all events
type EventHandler struct {
	eventConsumersByToken map[string][]events.Consumer
	geoResolver           geo.Resolver
	uaResolver            *useragent.Resolver
}

//Accept all events according to token
func NewEventHandler(eventConsumersByToken map[string][]events.Consumer) (eventHandler *EventHandler) {
	return &EventHandler{
		eventConsumersByToken: eventConsumersByToken,
		geoResolver:           appconfig.Instance.GeoResolver,
		uaResolver:            appconfig.Instance.UaResolver,
	}
}

func (eh *EventHandler) Handler(c *gin.Context) {
	payload := events.Fact{}
	if err := c.BindJSON(&payload); err != nil {
		c.Writer.WriteHeader(http.StatusBadRequest)
		return
	}
	ip := c.GetHeader("X-Real-IP")
	if ip == "" {
		ip = c.GetHeader("X-Forwarded-For")
	}
	if ip == "" {
		remoteAddr := c.Request.RemoteAddr
		if remoteAddr != "" {
			addrPort := strings.Split(remoteAddr, ":")
			ip = addrPort[0]
		}
	}

	geoData, err := eh.geoResolver.Resolve(ip)
	if err != nil {
		log.Println(err)
	}

	eventnObject, ok := payload[eventnKey]
	if ok {
		eventFact, ok := eventnObject.(events.Fact)
		if ok {
			//geo
			eventFact[geo.GeoDataKey] = geoData

			//user agent
			ua, ok := eventFact[uaKey]
			if ok {
				if uaStr, ok := ua.(string); ok {
					eventFact[useragent.ParsedUaKey] = eh.uaResolver.Resolve(uaStr)
				}
			}
		} else {
			log.Printf("%s isn't an object %v", eventnKey, eventnObject)
		}
	} else {
		log.Printf("Unable to get %s from %v", eventnKey, payload)
	}
	payload[timestamp.Key] = time.Now().Format(timestamp.Layout)

	token, ok := c.Get(middleware.TokenName)
	if !ok {
		log.Println("System error: token wasn't found in context")
	} else {
		consumers, ok := eh.eventConsumersByToken[token.(string)]
		if ok {
			for _, consumer := range consumers {
				consumer.Consume(payload)
			}
		} else {
			log.Printf("Unknown token[%s] request was received", token.(string))
		}
	}
}
