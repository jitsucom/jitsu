package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

var ErrProjectIDNotFoundInContext = fmt.Errorf("%s wasn't found in context", middleware.ProjectIDKey)

const jsonContentType = "application/json"

type DatabaseHandler struct {
	storage *storages.ConfigurationsService
}

type DbCreationRequestBody struct {
	ProjectID string `json:"projectID"`
}

func NewDatabaseHandler(configurationsStorage *storages.ConfigurationsService) *DatabaseHandler {
	return &DatabaseHandler{storage: configurationsStorage}
}

func (eh *DatabaseHandler) PostHandler(c *gin.Context) {
	body := DbCreationRequestBody{}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrResponse("Invalid input JSON", err))
		return
	}
	projectID := body.ProjectID
	userProjectID := c.GetString(middleware.ProjectIDKey)
	if userProjectID == "" {
		logging.SystemError(ErrProjectIDNotFoundInContext)
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrResponse("Project authorization error", ErrProjectIDNotFoundInContext))
		return
	}

	if userProjectID != projectID {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrResponse("User does not have access to project "+projectID, nil))
		return
	}

	database, err := eh.storage.CreateDefaultDestination(projectID)
	if err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrResponse("Failed to create a database for project "+projectID, err))
		return
	}

	c.JSON(http.StatusOK, database)
}

func extractUserID(c *gin.Context) string {
	iface, ok := c.Get(middleware.UserIDKey)
	if !ok {
		return ""
	}
	return iface.(string)
}

func hasAccessToProject(c *gin.Context, requestedProjectID string) bool {
	userProjectID, exists := c.Get("_project_id")
	if !exists || userProjectID != requestedProjectID {
		return false
	}
	return true
}
