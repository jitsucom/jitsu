package handlers

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io/ioutil"
	"mime/multipart"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/fallback"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
)

//BulkHandler is used for accepting bulk events requests from server 2 server integrations (CLI)
type BulkHandler struct {
	destinationService *destinations.Service
	processor          events.Processor
}

//NewBulkHandler returns configured BulkHandler
func NewBulkHandler(destinationService *destinations.Service, processor events.Processor) *BulkHandler {
	return &BulkHandler{
		destinationService: destinationService,
		processor:          processor,
	}
}

//BulkLoadingHandler loads file of events as one batch
func (bh *BulkHandler) BulkLoadingHandler(c *gin.Context) {
	apiKey := c.GetString(middleware.TokenName)
	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(apiKey)
	storageProxies := bh.destinationService.GetDestinations(tokenID)
	if len(storageProxies) == 0 {
		counters.SkipPushSourceEvents(tokenID, 1)
		c.JSON(http.StatusUnprocessableEntity, middleware.ErrResponse(fmt.Sprintf(noDestinationsErrTemplate, apiKey), nil))
		return
	}

	needCopyEvent := len(storageProxies) > 1

	eventObjects, err := extractBulkEvents(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	//use empty context (only IP) because server 2 server integration
	emptyContext := &events.RequestContext{ClientIP: extractIP(c)}
	uniqueIDField := storageProxies[0].GetUniqueIDField()
	for _, object := range eventObjects {
		enrichment.ContextEnrichmentStep(object, apiKey, emptyContext, bh.processor, uniqueIDField)
	}

	rowsCount := len(eventObjects)

	for _, storageProxy := range storageProxies {
		if err := bh.upload(storageProxy, eventObjects, needCopyEvent); err != nil {

			metrics.ErrorTokenEvents(tokenID, storageProxy.Type(), storageProxy.ID(), rowsCount)
			metrics.ErrorTokenObjects(tokenID, rowsCount)
			telemetry.Error(tokenID, storageProxy.ID(), events.SrcBulk, "", rowsCount)
			counters.ErrorPushDestinationEvents(storageProxy.ID(), int64(rowsCount))

			c.JSON(http.StatusBadRequest, middleware.ErrResponse("failed to process file payload", err))
			return
		}

		metrics.SuccessTokenEvents(tokenID, storageProxy.Type(), storageProxy.ID(), rowsCount)
		metrics.SuccessTokenObjects(tokenID, rowsCount)
		telemetry.Event(tokenID, storageProxy.ID(), events.SrcBulk, "", rowsCount)
		counters.SuccessPushDestinationEvents(storageProxy.ID(), int64(rowsCount))
	}

	counters.SuccessPushSourceEvents(tokenID, int64(rowsCount))

	c.JSON(http.StatusOK, middleware.OKResponse())
}

func extractBulkEvents(c *gin.Context) ([]map[string]interface{}, error) {
	file, err := c.FormFile("file")
	if err != nil {
		return nil, fmt.Errorf("failed to read 'file' form parameter: %v", err)
	}

	fileReader, err := file.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open 'file' form parameter: %v", err)
	}

	payload, err := readFileBytes(c.GetHeader("Content-Encoding"), fileReader)
	fileReader.Close()
	if err != nil {
		return nil, fmt.Errorf("failed to read payload from input file: %v", err)
	}

	fallbackRequest := c.Query("fallback") == "true"
	skipMalformed := c.Query("skip_malformed") == "true"
	objects, err := fallback.ExtractEvents(payload, !fallbackRequest, skipMalformed)
	if err != nil {
		return nil, fmt.Errorf("failed to parse JSON payload: %v", err)
	}

	return objects, nil
}

func (bh *BulkHandler) upload(storageProxy storages.StorageProxy, objects []map[string]interface{}, needCopyEvent bool) error {
	storage, ok := storageProxy.Get()
	if !ok {
		return fmt.Errorf("Destination [%s] hasn't been initialized yet", storage.ID())
	}
	if storage.IsStaging() {
		return fmt.Errorf("Error running bulk loading for destination [%s] in staged mode, "+
			"cannot be used to store data (only available for dry-run)", storage.ID())
	}

	return storage.SyncStore(nil, objects, "", true, needCopyEvent)
}

//readFileBytes reads file from form data and returns byte payload or err if occurred
//does unzip if file has been compressed
func readFileBytes(contentEncoding string, file multipart.File) ([]byte, error) {
	b, err := ioutil.ReadAll(file)
	if err != nil {
		return nil, err
	}

	if contentEncoding == "" {
		return b, nil
	}

	if contentEncoding != "gzip" {
		return nil, errors.New("only 'gzip' encoding is supported")
	}

	reader, err := gzip.NewReader(bytes.NewBuffer(b))
	if err != nil {
		return nil, err
	}

	var resB bytes.Buffer
	_, err = resB.ReadFrom(reader)
	if err != nil {
		return nil, err
	}

	return resB.Bytes(), nil
}
