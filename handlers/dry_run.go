package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/enrichment"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/middleware"
	"net/http"
)

const (
	emptyDestinationIdMessage   = "destination_id must not be empty"
	unknownDestinationIdMessage = "Destination with id=[%s] does not exist"
)

type DryRunHandler struct {
	destinationService *destinations.Service
	preprocessor       events.Preprocessor
}

func NewDryRunHandler(destinationService *destinations.Service, preprocessor events.Preprocessor) *DryRunHandler {
	return &DryRunHandler{destinationService: destinationService, preprocessor: preprocessor}
}

func (drh *DryRunHandler) Handle(c *gin.Context) {
	iface, ok := c.Get(middleware.TokenName)
	if !ok {
		logging.Error("Token wasn't found in context")
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "[token] parameter is not set"})
		return
	}
	token := iface.(string)
	payload := events.Event{}
	if err := c.BindJSON(&payload); err != nil {
		logging.Errorf("Error parsing event body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err.Error()})
		return
	}
	destinationId := c.Query("destination_id")
	if destinationId == "" {
		logging.Errorf(emptyDestinationIdMessage)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: emptyDestinationIdMessage})
		return
	}
	enrichment.ContextEnrichmentStep(payload, token, c.Request, drh.preprocessor)
	storageProxy, ok := drh.destinationService.GetStorageById(destinationId)
	if !ok {
		logging.Errorf(unknownDestinationIdMessage, destinationId)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: fmt.Sprintf(unknownDestinationIdMessage, destinationId)})
		return
	}
	storage, ok := storageProxy.Get()
	if !ok {
		logging.Errorf("Failed to get storage from proxy for id=%s", destinationId)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: fmt.Sprintf("Failed to get storage from proxy for id=%s", destinationId)})
		return
	}
	dataSchema, err := storage.DryRun(payload)
	if err != nil {
		dryRunError := fmt.Sprintf("Failed to get dry run response for destination id=[%s]", destinationId)
		logging.Errorf("%s: %v", dryRunError, err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: dryRunError, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, dataSchema)
}
