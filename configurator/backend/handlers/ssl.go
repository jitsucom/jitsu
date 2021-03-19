package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	middleware2 "github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/ssl"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"strings"
)

type CustomDomainHandler struct {
	updateExecutor *ssl.UpdateExecutor
}

func NewCustomDomainHandler(executor *ssl.UpdateExecutor) *CustomDomainHandler {
	return &CustomDomainHandler{executor}
}

func (h *CustomDomainHandler) PerProjectHandler(c *gin.Context) {
	projectId := c.Query("projectId")
	if !hasAccessToProject(c, projectId) {
		c.JSON(http.StatusUnauthorized, middleware.ErrorResponse{Message: "You are not authorized to request data for project " + projectId})
		return
	}
	async := false
	if strings.ToLower(c.Query("async")) == "true" {
		async = true
	}
	if projectId == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "projectId is a required query parameter"})
		return
	}
	if async {
		go h.updateExecutor.RunForProject(projectId)
		c.JSON(http.StatusOK, middleware2.OkResponse{Status: "scheduled SSL update"})
		return
	} else {
		err := h.updateExecutor.RunForProject(projectId)
		if err != nil {
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{
				Error:   err.Error(),
				Message: fmt.Sprintf("Error running SSL update for project [%s]", projectId),
			})
			return
		}
		c.JSON(http.StatusOK, middleware2.OkResponse{Status: "ok"})
	}
}

func (h *CustomDomainHandler) AllHandler(c *gin.Context) {
	async := false
	if strings.ToLower(c.Query("async")) == "true" {
		async = true
	}
	if async {
		go h.updateExecutor.Run()
		c.JSON(http.StatusOK, middleware2.OkResponse{Status: "scheduled ssl update"})
		return
	} else {
		err := h.updateExecutor.Run()
		if err != nil {
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Error: err.Error(), Message: "Error running"})
			return
		}
		c.JSON(http.StatusOK, middleware2.OkResponse{Status: "ok"})
	}
}
