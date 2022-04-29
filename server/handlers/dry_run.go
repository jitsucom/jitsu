package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
)

type DryRunHandler struct {
	destinationService *destinations.Service
	preprocessor       events.Processor
	geoService         *geo.Service
}

func NewDryRunHandler(destinationService *destinations.Service, preprocessor events.Processor,
	geoService *geo.Service) *DryRunHandler {
	return &DryRunHandler{
		destinationService: destinationService,
		preprocessor:       preprocessor,
		geoService:         geoService,
	}
}

func (drh *DryRunHandler) Handle(c *gin.Context) {
	payload := events.Event{}
	if err := c.BindJSON(&payload); err != nil {
		logging.Errorf("Error parsing event body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}
	destinationID := c.Query("destination_id")
	if destinationID == "" {
		emptyDestinationIDMessage := "Error getting [destination_id] parameter - it must not be empty"
		logging.Errorf(emptyDestinationIDMessage)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(emptyDestinationIDMessage, nil))
		return
	}

	storageProxy, ok := drh.destinationService.GetDestinationByID(destinationID)
	if !ok {
		destinationNotFoundErrorMessage := fmt.Sprintf("Error: destination with id=[%s] does not exist", destinationID)
		logging.Error(destinationNotFoundErrorMessage)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(destinationNotFoundErrorMessage, nil))
		return
	}
	storage, ok := storageProxy.Get()
	if !ok {
		logging.Errorf("Error getting storage from proxy for id=[%s]", destinationID)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(fmt.Sprintf("Failed to get storage from proxy for id=%s", destinationID), nil))
		return
	}

	//get geo resolver
	geoResolver := drh.geoService.GetGeoResolver(storageProxy.GetGeoResolverID())

	reqContext := getRequestContext(c, geoResolver, payload)

	//** Context enrichment **
	enrichment.ContextEnrichmentStep(payload, c.GetString(middleware.TokenName), reqContext, drh.preprocessor, storage.GetUniqueIDField())
	enrichment.HTTPContextEnrichmentStep(c, payload)

	dataSchema, err := storage.DryRun(payload)
	if err != nil {
		dryRunMsg := fmt.Sprintf("Error getting dry run response for destination with id=[%s]", destinationID)
		logging.Error("%s: %v", dryRunMsg, err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(dryRunMsg, err))
		return
	}

	c.JSON(http.StatusOK, dataSchema)
}
