package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/middleware"
	mdlwr "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

type ProjectsHandler struct {
	service *authorization.Service
}

func NewProjectsHandler(service *authorization.Service) *ProjectsHandler {
	return &ProjectsHandler{service: service}
}

func (ph *ProjectsHandler) GetProjects(c *gin.Context) {
	projects, err := ph.service.GetUserProjects(c.GetString(middleware.UserIDKey))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, mdlwr.ErrResponse(fmt.Sprintf("failed to get user's projects: %v", err), nil))
		return
	}

	c.JSON(http.StatusOK, projects)
}
