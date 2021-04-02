package handlers

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/drivers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

func SourcesHandler(c *gin.Context) {
	sourceConfig := &drivers.SourceConfig{}
	if err := c.BindJSON(sourceConfig); err != nil {
		logging.Errorf("Error parsing source body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err.Error()})
		return
	}
	err := testSourceConnection(sourceConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

func testSourceConnection(config *drivers.SourceConfig) error {
	constructor, ok := drivers.DriverConstructors[config.Type]
	if !ok {
		return drivers.ErrUnknownSource
	}

	var testCollection *drivers.Collection

	switch config.Type {
	case drivers.SingerType:
		testCollection = &drivers.Collection{
			Name: drivers.DefaultSingerCollection,
		}
	case drivers.FbMarketingType:
		testCollection = &drivers.Collection{
			Name: "insights",
		}
	case drivers.FirebaseType:
		testCollection = &drivers.Collection{
			Name: "users",
		}
	case drivers.GoogleAnalyticsType:
		testCollection = &drivers.Collection{
			Name: "ga_visits",
			Type: "report",
		}
	case drivers.GooglePlayType:
		testCollection = &drivers.Collection{
			Name: "sales",
		}
	case drivers.RedisType:
		testCollection = &drivers.Collection{
			Name: "config",
		}
	default:
		return errors.New("unsupported source type " + config.Type)

	}

	driver, err := constructor(context.Background(), config, testCollection)
	if err != nil {
		return err
	}

	return driver.TestConnection()
}
