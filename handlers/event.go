package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/geo"
	"github.com/ksensehq/eventnative/middleware"
	"github.com/ksensehq/eventnative/timestamp"
	"log"
	"net/http"
	"strings"
	"time"
)

const eventnKey = "eventn_ctx"

type EventHandler struct {
	eventConsumer events.Consumer
	geoResolver   geo.Resolver
}

func NewEventHandler() (eventHandler *EventHandler) {
	eventHandler = &EventHandler{}
	eventHandler.eventConsumer = appconfig.Instance.EventsConsumer
	eventHandler.geoResolver = appconfig.Instance.GeoResolver
	return
}

func (eh *EventHandler) Handler(c *gin.Context) {
	c.Header("Access-Control-Allow-Origin", "*")
	payload := map[string]interface{}{}
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

	kpixObject, ok := payload[eventnKey]
	if ok {
		koMap, ok := kpixObject.(map[string]interface{})
		if ok {
			koMap[geo.GeoDataKey] = geoData
		} else {
			log.Printf("%s isn't an object %v", eventnKey, kpixObject)
		}
	} else {
		log.Printf("Unable to get %s from %v", eventnKey, payload)
	}
	payload[timestamp.Key] = time.Now().Format(timestamp.Layout)

	token, ok := c.Get(middleware.TokenName)
	if !ok {
		log.Println("System error: token wasn't found in context")
	} else {
		eh.eventConsumer.Consume(payload, token.(string))
	}
}
