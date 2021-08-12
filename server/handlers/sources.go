package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/drivers"
	driversbase "github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/drivers/singer"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/storages"
	"net/http"
)

//ClearCacheRequest is a dto for ClearCache endpoint
type ClearCacheRequest struct {
	Source     string `json:"source"`
	Collection string `json:"collection"`
}

//SourcesHandler is used for testing sources connection and clean sync cache
type SourcesHandler struct {
	sourcesService      *sources.Service
	metaStorage         meta.Storage
	destinationsService *destinations.Service
}

//NewSourcesHandler returns configured SourcesHandler instance
func NewSourcesHandler(sourcesService *sources.Service, metaStorage meta.Storage, destinations *destinations.Service) *SourcesHandler {
	return &SourcesHandler{sourcesService: sourcesService, metaStorage: metaStorage}
}

//ClearCacheHandler deletes source state (signature) from meta.Storage
func (sh *SourcesHandler) ClearCacheHandler(c *gin.Context) {
	shouldCleanWarehouse := c.DefaultQuery("delete_warehouse_data", "false") == "true"
	req := &ClearCacheRequest{}
	if err := c.BindJSON(req); err != nil {
		logging.Errorf("Error parsing clear cache request: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}

	if req.Source == "" {
		req.Source = c.Query("source")
	}
	if req.Collection == "" {
		req.Collection = c.Query("collection")
	}

	if req.Source == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'source' is required query parameter", nil))
		return
	}

	source, err := sh.sourcesService.GetSource(req.Source)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error getting source by id", err))
		return
	}

	var multiErr error
	for collection, driver := range source.DriverPerCollection {
		if req.Collection != "" && req.Collection != collection {
			continue
		}

		err := sh.metaStorage.DeleteSignature(req.Source, driver.GetCollectionMetaKey())
		if err != nil {
			msg := fmt.Sprintf("Error clearing cache for source: [%s] collection: [%s]: %v", req.Source, collection, err)
			logging.Error(msg)
			multiErr = multierror.Append(multiErr, err)
		}
		if shouldCleanWarehouse {
			multiErr = sh.cleanWarehouse(driver, source.DestinationIDs, req.Source, collection, multiErr)
		}
	}

	if multiErr != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error clearing all collections cache", multiErr))
		return
	}

	c.JSON(http.StatusOK, middleware.OKResponse())
}

func (sh *SourcesHandler) cleanWarehouse(driver driversbase.Driver, destinationIds []string, sourceID string, collection string, multiErr error) error {
	for _, destId := range destinationIds {
		if destProxy, okDestProxy := sh.destinationsService.GetDestinationByID(destId); okDestProxy {
			if dest, okDest := destProxy.Get(); okDest {
				for _, destTableName := range sh.getTableNames(driver) {
					if err := dest.Clean(destTableName); err != nil {
						if err == storages.ErrTableNotExist {
							logging.Warnf("Table [%s] doesn't exist for: source: [%s], collection: [%s], destId: [%s]", destTableName, sourceID, collection, destId)
						} else {
							msg := fmt.Sprintf("Error cleaning warehouse for: source: [%s], collection: [%s], tableName: [%s], destId: [%s]: %v", sourceID, collection, destTableName, destId, err)
							logging.Error(msg)
							multiErr = multierror.Append(multiErr, err)
						}
					}
				}
			}
		}
	}

	return multiErr
}

func (sh *SourcesHandler) getTableNames(driver driversbase.Driver) []string {
	var tableNames []string
	if singerDriver, ok := driver.(*singer.Singer); ok {
		for _, destTableName := range singerDriver.GetStreamTableNameMapping() {
			tableNames = append(tableNames, destTableName)
		}
	} else {
		tableNames = append(tableNames, driver.GetCollectionTable())
	}

	return tableNames
}

//TestSourcesHandler tests source connection
func (sh *SourcesHandler) TestSourcesHandler(c *gin.Context) {
	sourceConfig := &driversbase.SourceConfig{}
	if err := c.BindJSON(sourceConfig); err != nil {
		logging.Errorf("Error parsing source body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}
	err := testSourceConnection(sourceConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}
	c.Status(http.StatusOK)
}

func testSourceConnection(config *driversbase.SourceConfig) error {
	testConnectionFunc, ok := driversbase.DriverTestConnectionFuncs[config.Type]
	if !ok {
		return drivers.ErrUnknownSource
	}

	return testConnectionFunc(config)
}
