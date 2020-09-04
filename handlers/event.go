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
	destinationService *events.DestinationService
	preprocessor       events.Preprocessor
}

//Accept all events according to token
func NewEventHandler(destinationService *events.DestinationService, preprocessor events.Preprocessor) (eventHandler *EventHandler) {
	return &EventHandler{
		destinationService: destinationService,
		preprocessor:       preprocessor,
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
	processed[timestamp.Key] = time.Now().UTC().Format(timestamp.Layout)

	consumers := eh.destinationService.GetConsumers(token)
	if len(consumers) == 0 {
		log.Printf("Unknown token[%s] request was received", token)
	} else {
		for _, consumer := range consumers {
			consumer.Consume(processed)
		}
	}
}
