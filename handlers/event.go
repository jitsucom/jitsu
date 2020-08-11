package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/middleware"
	"github.com/ksensehq/eventnative/timestamp"
	"log"
	"net/http"
	"time"
)

const apiTokenKey = "api_key"

//Accept all events
type EventHandler struct {
	eventConsumersByToken map[string][]events.Consumer
	preprocessor          events.Preprocessor
}

//Accept all events according to token
func NewEventHandler(eventConsumersByToken map[string][]events.Consumer, preprocessor events.Preprocessor) (eventHandler *EventHandler) {
	return &EventHandler{
		eventConsumersByToken: eventConsumersByToken,
		preprocessor:          preprocessor,
	}
}

func (eh *EventHandler) Handler(c *gin.Context) {
	payload := events.Fact{}
	if err := c.BindJSON(&payload); err != nil {
		c.Writer.WriteHeader(http.StatusBadRequest)
		return
	}

	iface, ok := c.Get(middleware.TokenName)
	if !ok {
		log.Println("System error: token wasn't found in context")
		return
	}
	token := iface.(string)

	processed, err := eh.preprocessor.Preprocess(payload, c.Request)
	if err != nil {
		log.Println("Error processing event:", err)
		c.Writer.WriteHeader(http.StatusBadRequest)
		return
	}

	processed[apiTokenKey] = token
	processed[timestamp.Key] = time.Now().Format(timestamp.Layout)

	consumers, ok := eh.eventConsumersByToken[token]
	if ok {
		for _, consumer := range consumers {
			consumer.Consume(processed)
		}
	} else {
		log.Printf("Unknown token[%s] request was received", token)
	}

}
