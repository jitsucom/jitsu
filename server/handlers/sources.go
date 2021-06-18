package handlers

import (
	"context"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/drivers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/sources"
	"net/http"
)

//ClearCacheRequest is a dto for ClearCache endpoint
type ClearCacheRequest struct {
	Source     string `json:"source"`
	Collection string `json:"collection"`
}

//SourcesHandler is used for testing sources connection and clean sync cache
type SourcesHandler struct {
	sourcesService *sources.Service
	metaStorage    meta.Storage
}

//NewSourcesHandler returns configured SourcesHandler instance
func NewSourcesHandler(sourcesService *sources.Service, metaStorage meta.Storage) *SourcesHandler {
	return &SourcesHandler{sourcesService: sourcesService, metaStorage: metaStorage}
}

//ClearCacheHandler deletes source state (signature) from meta.Storage
func (sh *SourcesHandler) ClearCacheHandler(c *gin.Context) {
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
	}

	if multiErr != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error clearing all collections cache", multiErr))
		return
	}

	c.JSON(http.StatusOK, middleware.OKResponse())
}

//TestSourcesHandler tests source connection
func (sh *SourcesHandler) TestSourcesHandler(c *gin.Context) {
	sourceConfig := &drivers.SourceConfig{}
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

func testSourceConnection(config *drivers.SourceConfig) error {
	constructor, ok := drivers.DriverConstructors[config.Type]
	if !ok {
		return drivers.ErrUnknownSource
	}

	collections, err := drivers.ParseCollections(config)
	if err != nil {
		return err
	}

	if len(collections) == 0 {
		switch config.Type {
		case drivers.SingerType:
			collections = append(collections, &drivers.Collection{
				Name: drivers.DefaultSingerCollection,
				Type: drivers.DefaultSingerCollection,
			})
		case drivers.FbMarketingType:
			collections = append(collections, &drivers.Collection{
				Name: drivers.InsightsCollection,
				Type: drivers.InsightsCollection,
			})
		case drivers.FirebaseType:
			collections = append(collections, &drivers.Collection{
				Name: drivers.UsersCollection,
				Type: drivers.UsersCollection,
			})
		case drivers.GoogleAnalyticsType:
			collections = append(collections, &drivers.Collection{
				Name: drivers.ReportsCollection,
				Type: drivers.ReportsCollection,
				Parameters: map[string]interface{}{
					"metrics":    []string{"test_metric"},
					"dimensions": []string{"test_dimensions"},
				},
			})
		case drivers.GooglePlayType:
			collections = append(collections, &drivers.Collection{
				Name: drivers.SalesCollection,
				Type: drivers.SalesCollection,
			})
		case drivers.RedisType:
			collections = append(collections, &drivers.Collection{
				Name: "test",
				Parameters: map[string]interface{}{
					"redis_key": "test",
				},
			})
		default:
			return errors.New("unsupported source type " + config.Type)
		}
	}

	for _, col := range collections {
		driver, err := constructor(context.Background(), config, col)
		if err != nil {
			return err
		}

		if err := testDriver(driver); err != nil {
			return err
		}
	}

	return nil
}

func testDriver(driver drivers.Driver) error {
	defer driver.Close()

	return driver.TestConnection()
}
