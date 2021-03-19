package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/configurator/middleware"
	"github.com/jitsucom/eventnative/configurator/storages"
	"github.com/jitsucom/eventnative/server/logging"
	enmiddleware "github.com/jitsucom/eventnative/server/middleware"
	"net/http"
)

var systemErrProjectId = fmt.Errorf("System error: %s wasn't found in context" + middleware.ProjectIdKey)

const jsonContentType = "application/json"

type DatabaseHandler struct {
	storage *storages.ConfigurationsService
}

type DbCreationRequestBody struct {
	ProjectId string `json:"projectId"`
}

func NewDatabaseHandler(configurationsStorage *storages.ConfigurationsService) *DatabaseHandler {
	return &DatabaseHandler{storage: configurationsStorage}
}

func (eh *DatabaseHandler) PostHandler(c *gin.Context) {
	body := DbCreationRequestBody{}
	if err := c.BindJSON(&body); err != nil {
		c.Writer.WriteHeader(http.StatusBadRequest)
		return
	}
	projectId := body.ProjectId
	userProjectId := c.GetString(middleware.ProjectIdKey)
	if userProjectId == "" {
		logging.Error(systemErrProjectId)
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Error: systemErrProjectId.Error(), Message: "Authorization error"})
		return
	}

	if userProjectId != projectId {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Message: "User does not have access to project " + projectId})
		return
	}

	database, err := eh.storage.CreateDefaultDestination(projectId)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Error: err.Error(), Message: "Failed to create a database for project " + projectId})
		return
	}

	c.JSON(http.StatusOK, database)
}

func extractUserId(c *gin.Context) string {
	iface, ok := c.Get(middleware.UserIdKey)
	if !ok {
		return ""
	}
	return iface.(string)
}

func hasAccessToProject(c *gin.Context, requestedProjectId string) bool {
	userProjectId, exists := c.Get("_project_id")
	if !exists || userProjectId != requestedProjectId {
		return false
	}
	return true
}
