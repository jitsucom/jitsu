package handlers

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	enauth "github.com/jitsucom/jitsu/server/authorization"
	"github.com/jitsucom/jitsu/server/logging"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"time"
)

const APIKeysGettingErrMsg = "API keys getting error"

var ErrProjectIDRequired = errors.New("project_id is required query parameter")

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
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrResponse(APIKeysGettingErrMsg, err))
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
		c.JSON(http.StatusBadRequest, enmiddleware.ErrResponse("Failed to parse request body", err))
		return
	}
	if body.ProjectID == "" {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrResponse(ErrProjectIDRequired.Error(), nil))
		return
	}
	userProjectID := c.GetString(middleware.ProjectIDKey)
	if userProjectID == "" {
		logging.SystemError(ErrProjectIDNotFoundInContext)
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrResponse("Project authorization error", ErrProjectIDNotFoundInContext))
		return
	}

	if userProjectID != body.ProjectID {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrResponse("User does not have access to project "+body.ProjectID, nil))
		return
	}
	if err := akh.configurationsService.CreateDefaultAPIKey(body.ProjectID); err != nil {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrResponse("Failed to create key for project "+body.ProjectID, err))
		return
	}
	c.JSON(http.StatusOK, enmiddleware.OKResponse())
}
