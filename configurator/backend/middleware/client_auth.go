package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

const (
	ProjectIDKey = "_project_id"
	UserIDKey    = "_user_id"
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
		userID, err := a.service.Authenticate(token)
		if err != nil {
			logging.Errorf("Failed to authenticate with token %s: %v", token, err)
			c.JSON(http.StatusUnauthorized, middleware.ErrResponse("You are not authorized", err))
			return
		}

		projectID, err := a.service.GetProjectID(userID)
		if err != nil {
			logging.SystemErrorf("Project id error in token %s: %v", token, err)
			c.JSON(http.StatusUnauthorized, middleware.ErrResponse("Authorization error", err))
			return
		}

		c.Set(ProjectIDKey, projectID)
		c.Set(UserIDKey, userID)
		c.Set(TokenKey, token)

		main(c)
	}
}

func (a *Authenticator) ClientAuth(main gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("X-Client-Auth")
		userID, err := a.service.Authenticate(token)
		if err != nil {
			logging.Errorf("Failed to authenticate with token %s: %v", token, err)
			c.JSON(http.StatusUnauthorized, middleware.ErrResponse("You are not authorized", err))
			return
		}

		c.Set(UserIDKey, userID)
		c.Set(TokenKey, token)

		main(c)
	}
}
