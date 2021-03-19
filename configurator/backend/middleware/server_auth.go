package middleware

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

//ServerAuth check server token
func ServerAuth(main gin.HandlerFunc, originalToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		queryValues := c.Request.URL.Query()
		token := queryValues.Get("token")
		if token == "" {
			token = c.GetHeader("X-Admin-Token")
		}

		if token != originalToken {
			c.Writer.WriteHeader(http.StatusUnauthorized)
			return
		}

		main(c)
	}
}
