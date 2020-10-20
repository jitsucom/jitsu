package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/destinations"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/middleware"
	"github.com/ksensehq/eventnative/telemetry"
	"github.com/ksensehq/eventnative/timestamp"
	"net/http"
)

const apiTokenKey = "api_key"

//Accept all events
type EventHandler struct {
	destinationService *destinations.Service
	preprocessor       events.Preprocessor
}

//Accept all events according to token
func NewEventHandler(destinationService *destinations.Service, preprocessor events.Preprocessor) (eventHandler *EventHandler) {
	return &EventHandler{
		destinationService: destinationService,
		preprocessor:       preprocessor,
	}
}

func (eh *EventHandler) Handler(c *gin.Context) {
	payload := events.Fact{}
	if err := c.BindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err})
		return
	}

	iface, ok := c.Get(middleware.TokenName)
	if !ok {
		logging.Error("System error: token wasn't found in context")
		return
	}
	token := iface.(string)

	processed, err := eh.preprocessor.Preprocess(payload, c.Request)
	if err != nil {
		logging.Error("Error processing event:", err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error processing event", Error: err})
		return
	}

	processed[apiTokenKey] = token
	processed[timestamp.Key] = timestamp.NowUTC()

	tokenId := appconfig.Instance.AuthorizationService.GetTokenId(token)

	consumers := eh.destinationService.GetConsumers(tokenId)
	if len(consumers) == 0 {
		logging.Warnf("Unknown token[%s] request was received", token)
	} else {
		telemetry.Event()

		for _, consumer := range consumers {
			consumer.Consume(processed, tokenId)
		}
	}
}
