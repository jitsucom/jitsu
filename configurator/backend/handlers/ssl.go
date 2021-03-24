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
	projectID := c.Query("projectID")
	if !hasAccessToProject(c, projectID) {
		c.JSON(http.StatusUnauthorized, middleware.ErrorResponse{Message: "You are not authorized to request data for project " + projectID})
		return
	}
	async := false
	if strings.ToLower(c.Query("async")) == "true" {
		async = true
	}
	if projectID == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "projectID is a required query parameter"})
		return
	}
	if async {
		go h.updateExecutor.RunForProject(projectID)
		c.JSON(http.StatusOK, middleware2.OkResponse{Status: "scheduled SSL update"})
		return
	}

	err := h.updateExecutor.RunForProject(projectID)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{
			Error:   err.Error(),
			Message: fmt.Sprintf("Error running SSL update for project [%s]", projectID),
		})
		return
	}
	c.JSON(http.StatusOK, middleware2.OkResponse{Status: "ok"})
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
	}

	err := h.updateExecutor.Run()
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Error: err.Error(), Message: "Error running"})
		return
	}
	c.JSON(http.StatusOK, middleware2.OkResponse{Status: "ok"})
}
