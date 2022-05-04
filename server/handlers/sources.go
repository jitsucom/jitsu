package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/drivers"
	driversbase "github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/oauth"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/sources"
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
	return &SourcesHandler{sourcesService: sourcesService, metaStorage: metaStorage, destinationsService: destinations}
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
				tableNames, err := sh.getTableNames(driver)
				if err != nil {
					multiErr = multierror.Append(multiErr, err)
					continue
				}

				for _, destTableName := range tableNames {
					if err := dest.Clean(destTableName); err != nil {
						if strings.Contains(err.Error(), adapters.ErrTableNotExist.Error()) {
							logging.Warnf("Table [%s] doesn't exist for: source: [%s], collection: [%s], destination: [%s]", destTableName, sourceID, collection, destId)
							continue
						}

						msg := fmt.Sprintf("Error cleaning warehouse for: source: [%s], collection: [%s], tableName: [%s], destination: [%s]: %v", sourceID, collection, destTableName, destId, err)
						logging.Error(msg)
						multiErr = multierror.Append(multiErr, err)
					}
				}
			}
		}
	}

	return multiErr
}

//getTableNames returns CLI tables if ready or just one table if not CLI
//reformat table names
func (sh *SourcesHandler) getTableNames(driver driversbase.Driver) ([]string, error) {
	if cliDriver, ok := driver.(driversbase.CLIDriver); ok {
		ready, err := cliDriver.Ready()
		if !ready {
			return nil, err
		}

		var tableNames []string
		for _, destTableName := range cliDriver.GetStreamTableNameMapping() {
			tableNames = append(tableNames, schema.Reformat(destTableName))
		}

		return tableNames, nil
	}

	return []string{schema.Reformat(driver.GetCollectionTable())}, nil
}

//TestSourcesHandler tests source connection
//returns:
//  200 with status ok if a connection is ok
//  200 with status pending if source isn't ready
//  200 with status pending and error in body if source isn't ready and has previous error
//  400 with error if a connection failed
func (sh *SourcesHandler) TestSourcesHandler(c *gin.Context) {
	sourceConfig := &driversbase.SourceConfig{}
	if err := c.BindJSON(sourceConfig); err != nil {
		logging.Errorf("Error parsing source body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}
	err := testSourceConnection(sourceConfig)
	if err != nil {
		if err == runner.ErrNotReady {
			c.JSON(http.StatusOK, middleware.PendingResponse())
			return
		}

		c.JSON(http.StatusBadRequest, middleware.ErrResponse("", err))
		return
	}

	c.JSON(http.StatusOK, middleware.OKResponse())
}

//OauthFields returns object with source config field that can be preconfigured on server side.
//Along with info what env pr yaml path need to configure field and current status (provided on server side or not)
func (sh *SourcesHandler) OauthFields(c *gin.Context) {
	res := make(map[string]interface{})
	sourceType := c.Param("sourceType")
	oauthConfig, ok := oauth.Get(sourceType)
	if ok {
		for k, v := range oauthConfig {
			fieldObject := make(map[string]interface{})
			fieldObject["env_name"] = v.EnvName
			fieldObject["yaml_path"] = v.YAMLPath
			fieldObject["provided"] = v.Provided
			res[k] = fieldObject
		}
	}
	c.JSON(http.StatusOK, res)
}

func testSourceConnection(config *driversbase.SourceConfig) error {
	testConnectionFunc, ok := driversbase.DriverTestConnectionFuncs[config.Type]
	if !ok {
		return drivers.ErrUnknownSource
	}

	return testConnectionFunc(config)
}
