package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
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
	destinationID := c.Query("destination_id")
	if destinationID == "" {
		emptyDestinationIDMessage := "Error getting [destination_id] parameter - it must not be empty"
		logging.Errorf(emptyDestinationIDMessage)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: emptyDestinationIDMessage})
		return
	}

	storageProxy, ok := drh.destinationService.GetStorageByID(destinationID)
	if !ok {
		destinationNotFoundErrorMessage := fmt.Sprintf("Error: destination with id=[%s] does not exist", destinationID)
		logging.Error(destinationNotFoundErrorMessage)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: destinationNotFoundErrorMessage})
		return
	}
	storage, ok := storageProxy.Get()
	if !ok {
		logging.Errorf("Error getting storage from proxy for id=[%s]", destinationID)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: fmt.Sprintf("Failed to get storage from proxy for id=%s", destinationID)})
		return
	}

	//** Context enrichment **
	enrichment.ContextEnrichmentStep(payload, c.GetString(middleware.TokenName), c.Request, drh.preprocessor, storage.GetUniqueIDField())

	dataSchema, err := storage.DryRun(payload)
	if err != nil {
		dryRunError := fmt.Sprintf("Error getting dry run response for destination with id=[%s], %v", destinationID, err)
		logging.Errorf("%s: %v", dryRunError, err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: dryRunError, Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dataSchema)
}
