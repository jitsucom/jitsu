package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/configurator/middleware"
	"github.com/jitsucom/eventnative/configurator/storages"
	enauth "github.com/jitsucom/eventnative/server/authorization"
	"github.com/jitsucom/eventnative/server/logging"
	enmiddleware "github.com/jitsucom/eventnative/server/middleware"
	"net/http"
	"time"
)

type ApiKeysHandler struct {
	configurationsService *storages.ConfigurationsService
}

func NewApiKeysHandler(configurationsService *storages.ConfigurationsService) *ApiKeysHandler {
	return &ApiKeysHandler{configurationsService: configurationsService}
}

func (akh *ApiKeysHandler) GetHandler(c *gin.Context) {
	begin := time.Now()
	keys, err := akh.configurationsService.GetApiKeys()
	if err != nil {
		logging.Error(err)
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrorResponse{Error: err.Error(), Message: "Api keys err"})
		return
	}

	var tokens []enauth.Token
	for _, k := range keys {
		tokens = append(tokens, enauth.Token{
			Id:           k.Id,
			ClientSecret: k.ClientSecret,
			ServerSecret: k.ServerSecret,
			Origins:      k.Origins,
		})
	}

	logging.Debugf("ApiKeys response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, &enauth.TokensPayload{Tokens: tokens})
}

type ApiKeyCreationRequest struct {
	ProjectId string `json:"projectId"`
}

func (akh *ApiKeysHandler) CreateDefaultApiKeyHandler(c *gin.Context) {
	body := DbCreationRequestBody{}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "Failed to parse request body", Error: err.Error()})
		return
	}
	if body.ProjectId == "" {
		c.JSON(http.StatusBadRequest, enmiddleware.ErrorResponse{Message: "[project_id] absents at request body"})
		return
	}
	userProjectId := c.GetString(middleware.ProjectIdKey)
	if userProjectId == "" {
		logging.Error(systemErrProjectId)
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Error: systemErrProjectId.Error(), Message: "Authorization error"})
		return
	}

	if userProjectId != body.ProjectId {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Message: "User does not have access to project " + body.ProjectId})
		return
	}
	if err := akh.configurationsService.CreateDefaultApiKey(body.ProjectId); err != nil {
		c.JSON(http.StatusUnauthorized, enmiddleware.ErrorResponse{Message: "Failed to create key for project " + body.ProjectId, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, enmiddleware.OkResponse())
}
