package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

const (
	ProjectIdKey = "_project_id"
	UserIdKey    = "_user_id"
	TokenKey     = "_token"
)

type Authenticator struct {
	service *authorization.Service
}

func NewAuthenticator(service *authorization.Service) *Authenticator {
	return &Authenticator{service: service}
}

func (a *Authenticator) ClientProjectAuth(main gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("X-Client-Auth")
		userId, err := a.service.Authenticate(token)
		if err != nil {
			logging.Errorf("Failed to authenticate with token %s: %v", token, err)
			c.JSON(http.StatusUnauthorized, middleware.ErrorResponse{Error: err.Error(), Message: "You are not authorized"})
			return
		}

		projectId, err := a.service.GetProjectId(userId)
		if err != nil {
			logging.SystemErrorf("Project id error in token %s: %v", token, err)
			c.JSON(http.StatusUnauthorized, middleware.ErrorResponse{Message: "Authorization error", Error: err.Error()})
			return
		}

		c.Set(ProjectIdKey, projectId)
		c.Set(UserIdKey, userId)
		c.Set(TokenKey, token)

		main(c)
	}
}

func (a *Authenticator) ClientAuth(main gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("X-Client-Auth")
		userId, err := a.service.Authenticate(token)
		if err != nil {
			logging.Errorf("Failed to authenticate with token %s: %v", token, err)
			c.JSON(http.StatusUnauthorized, middleware.ErrorResponse{Error: err.Error(), Message: "You are not authorized"})
			return
		}

		c.Set(UserIdKey, userId)
		c.Set(TokenKey, token)

		main(c)
	}
}
