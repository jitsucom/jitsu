package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/jsonutils"
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
	go doTracking(c.Copy())

	c.Data(http.StatusOK, "image/gif", handler.data)
}

func doTracking(c *gin.Context) {
	event := map[string]interface{}{}

	parameters := c.Request.URL.Query()

	data := parameters.Get("data")
	if data != "" {
		value, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			logging.Debugf("Error decoding string: %v", err)
		} else {
			err = json.Unmarshal(value, &event)
			if err != nil {
				logging.Debugf("Error parsing JSON event: %v", err)
			}
		}
	}

	for key, value := range parameters {
		if key == "data" {
			continue
		}

		converted := strings.ReplaceAll(key, ".", "/")
		path := jsonutils.NewJSONPath(converted)
		path.Set(event, value)
	}

	compatibility := false
	if _, ok := event["compat"]; ok {
		compatibility = true
	}

	logging.Infof("Compatibility: %v, Event: %v", compatibility, event)
}
