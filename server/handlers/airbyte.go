package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
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

	spec, err := airbyte.Instance.GetOrLoadSpec(dockerImage)
	if err != nil {
		//pending status with error (some previous spec loads failed)
		c.JSON(http.StatusOK, middleware.PendingResponseWithMessage(fmt.Sprintf("Previous spec load failed: %v. Started a new spec load task.", err)))
		return
	}

	if spec != nil {
		c.JSON(http.StatusOK, SpecResponse{
			StatusResponse: middleware.OKResponse(),
			Spec:           spec,
		})
		return
	}

	c.JSON(http.StatusOK, middleware.PendingResponse())
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

	catalog, err := airbyte.Instance.GetOrLoadCatalog(dockerImage, airbyteSourceConnectorConfig)
	if err != nil {
		//pending status with error (some previous catalog loads failed)
		c.JSON(http.StatusOK, middleware.PendingResponseWithMessage(fmt.Sprintf("Previous catalog load failed: %v. Started a new catalog load task.", err)))
		return
	}

	if catalog != nil {
		c.JSON(http.StatusOK, CatalogResponse{
			StatusResponse: middleware.OKResponse(),
			Catalog:        catalog,
		})
		return
	}

	c.JSON(http.StatusOK, middleware.PendingResponse())
}
