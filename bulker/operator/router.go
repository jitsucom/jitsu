package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/appbase"
)

type Router struct {
	*appbase.Router
	appContext *Context
}

func NewRouter(appContext *Context) *Router {
	base := appbase.NewRouterBase(appContext.config.Config, []string{"/health", "/ready"})
	r := &Router{
		Router:     base,
		appContext: appContext,
	}
	r.Engine().GET("/health", r.HealthHandler)
	r.Engine().GET("/ready", r.ReadyHandler)
	r.Engine().GET("/status", r.StatusHandler)
	return r
}

func (r *Router) HealthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (r *Router) ReadyHandler(c *gin.Context) {
	op := r.appContext.operator
	if op == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready", "reason": "operator not initialized"})
		return
	}

	if !op.connectionsRepo.Loaded() || !op.functionsRepo.Loaded() || !op.workspacesRepo.Loaded() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready", "reason": "repositories not loaded"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}

func (r *Router) StatusHandler(c *gin.Context) {
	op := r.appContext.operator
	if op == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not initialized"})
		return
	}

	op.mu.RLock()
	defer op.mu.RUnlock()

	deployedWorkspaces := make([]map[string]any, 0, len(op.deployedWorkspaces))
	for workspaceID, wsData := range op.deployedWorkspaces {
		deployedWorkspaces = append(deployedWorkspaces, map[string]any{
			"workspaceId":  workspaceID,
			"configHash":   wsData.ConfigHash,
			"maxUpdatedAt": wsData.MaxUpdatedAt,
			"connections":  len(wsData.Connections),
			"functions":    len(wsData.Functions),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"repositories": gin.H{
			"connections": gin.H{
				"loaded":      op.connectionsRepo.Loaded(),
				"lastSuccess": op.connectionsRepo.LastSuccess(),
			},
			"functions": gin.H{
				"loaded":      op.functionsRepo.Loaded(),
				"lastSuccess": op.functionsRepo.LastSuccess(),
			},
			"workspaces": gin.H{
				"loaded":      op.workspacesRepo.Loaded(),
				"lastSuccess": op.workspacesRepo.LastSuccess(),
			},
		},
		"deployedWorkspaces": deployedWorkspaces,
	})
}
