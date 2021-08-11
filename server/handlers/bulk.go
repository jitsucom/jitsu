package handlers

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/storages"
	"io/ioutil"
	"mime/multipart"
	"net/http"
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
		c.JSON(http.StatusUnprocessableEntity, middleware.ErrResponse(fmt.Sprintf(noDestinationsErrTemplate, apiKey), nil))
		return
	}

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

	for _, storageProxy := range storageProxies {
		if err := bh.upload(storageProxy, eventObjects); err != nil {
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("failed to process file payload", err))
			return
		}
	}

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

	objects, err := parsers.ParseJSONFile(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to parse JSON payload from input file: %v", err)
	}

	return objects, nil
}

func (bh *BulkHandler) upload(storageProxy storages.StorageProxy, objects []map[string]interface{}) error {
	storage, ok := storageProxy.Get()
	if !ok {
		return fmt.Errorf("Destination [%s] hasn't been initialized yet", storage.ID())
	}
	if storage.IsStaging() {
		return fmt.Errorf("Error running bulk loading for destination [%s] in staged mode, "+
			"cannot be used to store data (only available for dry-run)", storage.ID())
	}

	return storage.SyncStore(nil, objects, "", true)
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
