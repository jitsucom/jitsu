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

type DryRunHandler struct {
	destinationService *destinations.Service
	preprocessor       events.Preprocessor
}

func NewDryRunHandler(destinationService *destinations.Service, preprocessor events.Preprocessor) *DryRunHandler {
	return &DryRunHandler{destinationService: destinationService, preprocessor: preprocessor}
}

func (drh *DryRunHandler) Handle(c *gin.Context) {
	payload := events.Event{}
	if err := c.BindJSON(&payload); err != nil {
		logging.Errorf("Error parsing event body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err.Error()})
		return
	}
	destinationId := c.Query("destination_id")
	if destinationId == "" {
		emptyDestinationIdMessage := "Error getting [destination_id] parameter - it must not be empty"
		logging.Errorf(emptyDestinationIdMessage)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: emptyDestinationIdMessage})
		return
	}
	enrichment.ContextEnrichmentStep(payload, c.GetString(middleware.TokenName), c.Request, drh.preprocessor)
	storageProxy, ok := drh.destinationService.GetStorageById(destinationId)
	if !ok {
		destinationNotFoundErrorMessage := fmt.Sprintf("Error: destination with id=[%s] does not exist", destinationId)
		logging.Error(destinationNotFoundErrorMessage)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: destinationNotFoundErrorMessage})
		return
	}
	storage, ok := storageProxy.Get()
	if !ok {
		logging.Errorf("Error getting storage from proxy for id=[%s]", destinationId)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: fmt.Sprintf("Failed to get storage from proxy for id=%s", destinationId)})
		return
	}
	dataSchema, err := storage.DryRun(payload)
	if err != nil {
		dryRunError := fmt.Sprintf("Error getting dry run response for destination with id=[%s], %v", destinationId, err)
		logging.Errorf("%s: %v", dryRunError, err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: dryRunError, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, dataSchema)
}
