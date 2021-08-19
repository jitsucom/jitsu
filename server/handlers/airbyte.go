package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"strings"
)

const airbytePrefix = "airbyte"

type SpecResponse struct {
	middleware.StatusResponse

	Spec interface{} `json:"spec"`
}

type AirbyteHandler struct{}

func NewAirbyteHandler() *AirbyteHandler {
	return &AirbyteHandler{}
}

func (ah *AirbyteHandler) SpecHandler(c *gin.Context) {
	dockerImage := c.Param("dockerImageName")
	if dockerImage == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("docker image name is required path parameter", nil))
		return
	}
	if !strings.HasPrefix(dockerImage, airbytePrefix) {
		dockerImage = airbytePrefix + "/" + dockerImage
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
