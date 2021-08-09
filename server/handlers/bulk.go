package handlers

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/storages"
	"io/ioutil"
	"mime/multipart"
	"net/http"
)

type BulkHandler struct {
	destinationService *destinations.Service
}

func NewBulkHandler(destinationService *destinations.Service) *BulkHandler {
	return &BulkHandler{
		destinationService: destinationService,
	}
}

//BulkLoadingHandler loads file of events as one batch
func (bh *BulkHandler) BulkLoadingHandler(c *gin.Context) {
	apiKey := c.GetString(middleware.TokenName)

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("failed to read 'file' form parameter", err))
		return
	}

	fileReader, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("failed to open 'file' form parameter", err))
		return
	}

	payload, err := readFileBytes(c.GetHeader("Content-Encoding"), fileReader)
	fileReader.Close()
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("failed to read payload from input file", err))
		return
	}

	objects, err := parsers.ParseJSONFile(payload)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("failed to parse JSON payload from input file", err))
		return
	}

	if err := bh.upload(apiKey, objects); err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("failed to process file payload", err))
		return
	}

	c.JSON(http.StatusOK, middleware.OKResponse())

}

func (bh *BulkHandler) upload(apiKey string, objects []map[string]interface{}) error {
	var storageProxies []storages.StorageProxy
	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(apiKey)
	storageProxies = bh.destinationService.GetDestinations(tokenID)

	for _, storageProxy := range storageProxies {
		storage, ok := storageProxy.Get()
		if !ok {
			return fmt.Errorf("Destination [%s] hasn't been initialized yet", storage.ID())
		}
		if storage.IsStaging() {
			return fmt.Errorf("Error running bulk loading for destination [%s] in staged mode, "+
				"cannot be used to store data (only available for dry-run)", storage.ID())
		}

		if err := storage.SyncStore(nil, objects, "", false); err != nil {
			return err
		}
	}

	return nil
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
