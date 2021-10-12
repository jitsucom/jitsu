package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/runner"
	"net/http"
)

type SpecResponse struct {
	middleware.StatusResponse

	Spec interface{} `json:"spec"`
}

type CatalogResponse struct {
	middleware.StatusResponse

	Catalog interface{} `json:"catalog"`
}

type AirbyteHandler struct{}

func NewAirbyteHandler() *AirbyteHandler {
	return &AirbyteHandler{}
}

//SpecHandler returns airbyte spec by docker name
func (ah *AirbyteHandler) SpecHandler(c *gin.Context) {
	dockerImage := c.Param("dockerImageName")
	if dockerImage == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("docker image name is required path parameter", nil))
		return
	}

	airbyteRunner := airbyte.NewRunner(dockerImage, airbyte.LatestVersion, "")
	spec, err := airbyteRunner.Spec()
	if err != nil {
		if err == runner.ErrNotReady {
			c.JSON(http.StatusOK, middleware.PendingResponse())
			return
		}

		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, SpecResponse{
		StatusResponse: middleware.OKResponse(),
		Spec:           spec,
	})
}

//CatalogHandler returns airbyte catalog by docker name and config
func (ah *AirbyteHandler) CatalogHandler(c *gin.Context) {
	dockerImage := c.Param("dockerImageName")
	if dockerImage == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("docker image name is required path parameter", nil))
		return
	}

	airbyteSourceConnectorConfig := map[string]interface{}{}
	if err := c.BindJSON(&airbyteSourceConnectorConfig); err != nil {
		logging.Errorf("Error parsing airbyte source connector body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}

	airbyteRunner := airbyte.NewRunner(dockerImage, airbyte.LatestVersion, "")
	catalogRow, err := airbyteRunner.Discover(airbyteSourceConnectorConfig)
	if err != nil {
		if err == runner.ErrNotReady {
			c.JSON(http.StatusOK, middleware.PendingResponse())
			return
		}

		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, CatalogResponse{
		StatusResponse: middleware.OKResponse(),
		Catalog:        catalogRow,
	})
}
