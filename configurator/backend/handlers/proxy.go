package handlers

import (
	"github.com/jitsucom/jitsu/configurator/entities"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/jitsu"
	mw "github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/server/logging"
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

// Handler proxies requests to Jitsu Server with validation
func (ph *ProxyHandler) Handler(ctx *gin.Context) {
	if ctx.IsAborted() {
		return
	}

	start := time.Now()
	if authority, err := mw.GetAuthority(ctx); err != nil {
		mw.Unauthorized(ctx, err)
	} else if projectID := mw.ExtractProjectID(ctx); projectID == "" {
		mw.RequiredField(ctx, "project_id")
	} else if authority.CheckPermission(ctx, projectID, entities.ViewConfigPermission) {
		if req, err := ph.getJitsuRequest(ctx); err != nil {
			mw.BadRequest(ctx, "Failed to create proxy request to Jitsu server", err)
		} else if serverStatusCode, serverResponse, err := ph.jitsuService.ProxySend(req); err != nil {
			mw.BadRequest(ctx, "Failed to proxy request to Jitsu server", err)
		} else {
			logging.Debugf("%s response in [%.2f] seconds", ctx.Request.URL.Path, time.Now().Sub(start).Seconds())
			ctx.Data(serverStatusCode, jsonContentType, serverResponse)
		}
	}
}

func (ph *ProxyHandler) getJitsuRequest(c *gin.Context) (*jitsu.Request, error) {
	decorator, ok := ph.decorators[c.Request.URL.Path]
	if ok {
		return decorator(c)
	}

	return jitsu.BuildRequest(c), nil
}
