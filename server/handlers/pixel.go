package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
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

	restoreEvent(event, c)

	enrichEvent(event, c)
}

func restoreEvent(event map[string]interface{}, c *gin.Context) {
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
}

func enrichEvent(event map[string]interface{}, c *gin.Context) {
	compatibility := false
	if _, ok := event["compat"]; ok {
		compatibility = true
	}

	urlField := "url"
	hostField := "doc_host"
	pathField := "doc_path"
	searchField := "doc_search"
	userIdField := "user/anonymous_id"
	agentField := "user_agent"
	timeField := "utc_time"
	if compatibility {
		urlField = "eventn_ctx/url"
		hostField = "eventn_ctx/doc_host"
		pathField = "eventn_ctx/doc_path"
		searchField = "eventn_ctx/doc_search"
		userIdField = "eventn_ctx/user/anonymous_id"
		agentField = "eventn_ctx/user_agent"
		timeField = "eventn_ctx/utc_time"
	}

	path := jsonutils.NewJSONPath(urlField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.RemoteAddr)
	}

	path = jsonutils.NewJSONPath(hostField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.Host)
	}

	path = jsonutils.NewJSONPath(pathField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.URL.Path)
	}

	path = jsonutils.NewJSONPath(searchField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.URL.RawQuery)
	}

	path = jsonutils.NewJSONPath(userIdField)
	if _, exist := path.Get(event); !exist {
		domain, ok := event["cookie_domain"]
		if !ok {
			domain = c.Request.Host
		}

		if domain_str, ok := domain.(string); ok {
			cookie, err := c.Request.Cookie(domain_str)
			if err == nil && cookie != nil {
				path.Set(event, cookie.Value)
			}
		}
	}

	path = jsonutils.NewJSONPath(agentField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, c.Request.UserAgent())
	}

	path = jsonutils.NewJSONPath(timeField)
	if _, exist := path.Get(event); !exist {
		path.Set(event, timestamp.NowUTC())
	}

	event["src"] = "jitsu_gif"
}
