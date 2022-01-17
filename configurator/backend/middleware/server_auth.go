package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

//ServerAuth checks server token
//extracts token from query, X-Admin-Token and Authorization headers
func ServerAuth(main gin.HandlerFunc, originalToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		queryValues := c.Request.URL.Query()
		token := queryValues.Get("token")
		if token == "" {
			token = c.GetHeader("X-Admin-Token")
		}

		if token == "" {
			//bearer
			authHeader := c.GetHeader(bearerAuthHeader)
			if len(authHeader) > 0 {
				matches := tokenRe.FindAllStringSubmatch(authHeader, -1)
				if len(matches) > 0 && len(matches[0]) > 0 {
					token = matches[0][1]
				}
			}
		}

		if token != originalToken {
			c.AbortWithStatusJSON(http.StatusUnauthorized, middleware.ErrResponse("Server Token mismatch", nil))
			return
		}

		main(c)
	}
}
