package handlers

import (
	"encoding/base64"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/logging"
)

const TRACKING_PIXEL = "R0lGODlhAQABAIAAAAAAAP8AACH5BAEAAAEALAAAAAABAAEAAAICTAEAOw=="

type PixelHandler struct {
	data []byte
}

func NewPixelHandler() *PixelHandler {
	var err error
	handler := &PixelHandler{}

	handler.data, err = base64.StdEncoding.DecodeString(TRACKING_PIXEL)
	if err != nil {
		logging.Warnf("Cannot decode image for tracking pixel: %v", err)
	}

	return handler
}

func (handler *PixelHandler) Handle(c *gin.Context) {
	c.Data(http.StatusOK, "image/gif", handler.data)
}
