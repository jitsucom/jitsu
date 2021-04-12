package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/jitsu"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/server/logging"
	smdlwr "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"strings"
	"time"
)

type ProxyHandler struct {
	jitsuService *jitsu.Service
	decorators   map[string]jitsu.APIDecorator
}

func NewProxyHandler(jitsuService *jitsu.Service, decorators map[string]jitsu.APIDecorator) *ProxyHandler {
	return &ProxyHandler{
		jitsuService: jitsuService,
		decorators:   decorators,
	}
}

//Handler proxies requests to Jitsu Server with validation
func (ph *ProxyHandler) Handler(c *gin.Context) {
	begin := time.Now()

	logging.Info("Path", c.Param("path"))

	projectID := c.Query("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, smdlwr.ErrorResponse{Message: "[project_id] is a required query parameter"})
		return
	}

	userProjectID := c.GetString(middleware.ProjectIDKey)
	if userProjectID == "" {
		logging.SystemError(ErrProjectIDNotFoundInContext)
		c.JSON(http.StatusUnauthorized, smdlwr.ErrorResponse{Error: ErrProjectIDNotFoundInContext.Error(), Message: "Authorization error"})
		return
	}

	if userProjectID != projectID {
		c.JSON(http.StatusUnauthorized, smdlwr.ErrorResponse{Message: "User does not have access to project " + projectID})
		return
	}

	req := ph.getJitsuRequest(c)

	logging.Infof("%v", *req)

	code, payload, err := ph.jitsuService.ProxySend(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, smdlwr.ErrorResponse{Message: "Failed to proxy request to Jitsu server", Error: err.Error()})
		return
	}

	c.Header("Content-Type", jsonContentType)
	c.Writer.WriteHeader(code)

	_, err = c.Writer.Write(payload)
	if err != nil {
		c.JSON(http.StatusBadRequest, smdlwr.ErrorResponse{Message: "Failed to write proxy response", Error: err.Error()})
	}

	logging.Debugf("%s response in [%.2f] seconds", c.Request.URL.Path, time.Now().Sub(begin).Seconds())
}

func (ph *ProxyHandler) getJitsuRequest(c *gin.Context) *jitsu.Request {
	decorator, ok := ph.decorators[c.Request.URL.Path]
	if ok {
		return decorator(c)
	}

	urn := strings.TrimPrefix(c.Request.URL.Path, "/proxy")
	query := c.Request.URL.Query().Encode()
	if query != "" {
		urn += "?" + query
	}

	return &jitsu.Request{
		Method: c.Request.Method,
		URN:    urn,
		Body:   c.Request.Body,
	}
}
