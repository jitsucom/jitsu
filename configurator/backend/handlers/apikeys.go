package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	enauth "github.com/jitsucom/jitsu/server/authorization"
	"github.com/jitsucom/jitsu/server/logging"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"time"
)

type APIKeysHandler struct {
	configurationsService *storages.ConfigurationsService
}

func NewAPIKeysHandler(configurationsService *storages.ConfigurationsService) *APIKeysHandler {
	return &APIKeysHandler{configurationsService: configurationsService}
}

func (akh *APIKeysHandler) GetHandler(c *gin.Context) {
	begin := time.Now()
	keys, err := akh.configurationsService.GetAPIKeys()
	if err != nil {
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrorResponse{Error: err.Error(), Message: "API keys err"})
		return
	}

	var tokens []enauth.Token
	for _, k := range keys {
		tokens = append(tokens, enauth.Token{
			ID:           k.ID,
			ClientSecret: k.ClientSecret,
			ServerSecret: k.ServerSecret,
			Origins:      k.Origins,
		})
	}

	logging.Debugf("APIKeys response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, &enauth.TokensPayload{Tokens: tokens})
}

type APIKeyCreationRequest struct {
	ProjectID string `json:"projectID"`
}

func (akh *APIKeysHandler) CreateDefaultAPIKeyHandler(c *gin.Context) {
	body := DbCreationRequestBody{}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Failed to parse request body", Error: err.Error()})
		return
	}
	if body.ProjectID == "" {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "[project_id] absents at request body"})
		return
	}
	userProjectID := c.GetString(middleware.ProjectIDKey)
	if userProjectID == "" {
		logging.SystemError(ErrProjectIDNotFoundInContext)
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Error: ErrProjectIDNotFoundInContext.Error(), Message: "Authorization error"})
		return
	}

	if userProjectID != body.ProjectID {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Message: "User does not have access to project " + body.ProjectID})
		return
	}
	if err := akh.configurationsService.CreateDefaultAPIKey(body.ProjectID); err != nil {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Message: "Failed to create key for project " + body.ProjectID, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, enmiddleware.OkResponse())
}
