package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/parsers"
	"io/ioutil"
	"net/http"
)

type BulkHandler struct {
	destinationService *destinations.Service
}

//BulkLoadingHandler loads file of events as one batch
func (bh *BulkHandler) BulkLoadingHandler(c *gin.Context) {
	/*apiKey, ok := c.GetPostForm("api_key")
	if !ok {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'api_key' is a required form data parameter", nil))
		return
	}*/

	destinationID, ok := c.GetPostForm("destination_id")
	if !ok {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'destination_id' is a required form data parameter", nil))
		return
	}

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

	payload, err := ioutil.ReadAll(fileReader)
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

	if err := bh.upload(destinationID, objects); err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("failed to process file payload", err))
		return
	}

	c.JSON(http.StatusOK, middleware.OKResponse())

}

func (bh *BulkHandler) upload(destinationID string, objects []map[string]interface{}) error {
	storageProxy, ok := bh.destinationService.GetDestinationByID(destinationID)
	if !ok {
		return fmt.Errorf("Destination [%s] wasn't found", destinationID)
	}

	storage, ok := storageProxy.Get()
	if !ok {
		return fmt.Errorf("Destination [%s] hasn't been initialized yet", destinationID)
	}
	if storage.IsStaging() {
		return fmt.Errorf("Error running fallback for destination [%s] in staged mode, "+
			"cannot be used to store data (only available for dry-run)", destinationID)
	}

	return storage.SyncStore(nil, objects, "", false)
}
