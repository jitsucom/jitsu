package middleware

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/appconfig"
	"net/http"
	"strings"
)

func Authorization(main gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := strings.Split(c.GetHeader("Authorization"), "Bearer ")
		if len(authHeader) != 2 {
			c.AbortWithError(http.StatusUnauthorized, errors.New("Malformed Token"))
			return
		}

		if !appconfig.Instance.AuthorizationService.IsAuthorized(authHeader[1]) {
			c.AbortWithError(http.StatusUnauthorized, errors.New("401 Unauthorized\n"))
			return
		}

		main(c)
	}
}
