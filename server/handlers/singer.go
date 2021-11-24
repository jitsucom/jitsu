package handlers

import (
	"github.com/gin-gonic/gin"
	driversbase "github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/singer"
	"github.com/jitsucom/jitsu/server/synchronization"
	"io/ioutil"
	"net/http"
	"time"
)

type SingerHandler struct{
	metaStorage       meta.Storage
}

func NewSingerHandler(metaStorage meta.Storage) *SingerHandler { return &SingerHandler{metaStorage: metaStorage} }

func (sh *SingerHandler) CatalogHandler(c *gin.Context) {
	tap := c.Param("tap")
	if tap == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("tap is required path parameter", nil))
		return
	}

	sourceId := c.Query("source_id")
	if tap == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("source_id is required query parameter", nil))
		return
	}
	singerSourceConnectorConfig := map[string]interface{}{}
	if err := c.BindJSON(&singerSourceConnectorConfig); err != nil {
		logging.Errorf("Error parsing singer source connector body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}
	driversbase.FillPreconfiguredOauth(tap, singerSourceConnectorConfig)

	ready, err := waitReadiness(tap)
	if err != nil {
		c.JSON(http.StatusOK, middleware.ErrResponse("Failed to install Singer tap", err))
		return
	}

	if !ready {
		c.JSON(http.StatusOK, middleware.PendingResponse())
		return
	}

	configPath, err := singer.SaveConfig(sourceId, tap, singerSourceConnectorConfig)
	if err != nil {
		logging.Errorf("Cannot save config to file: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Cannot save config to file", err))
		return
	}

	catalog, err := singer.Instance.Discover(tap, configPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	//Config file might be updated by singer tap after discover method.
	//We need to write it to persistent storage so other cluster nodes will read actual config
	configBytes, err := ioutil.ReadFile(configPath)
	if configBytes != nil {
		err = sh.metaStorage.SaveSignature(sourceId, tap + synchronization.ConfigSignatureSuffix, driversbase.ALL.String(), string(configBytes))
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("cannot write config to persisting storage", err))
		return
	}

	c.JSON(http.StatusOK, CatalogResponse{
		StatusResponse: middleware.OKResponse(),
		Catalog:        catalog,
	})
}

//wait 1 minute if not installed
func waitReadiness(tap string) (bool, error) {
	seconds := 0
	for seconds < 60 {
		ready, err := singer.Instance.IsTapReady(tap)
		if err != nil {
			return false, err
		}

		if ready {
			return true, nil
		}

		time.Sleep(time.Second)
		seconds += 1
	}

	return false, nil
}
