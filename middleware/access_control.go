package middleware

import (
	"github.com/gin-gonic/gin"
	"log"
	"net/http"
)

//AccessControl check that provided token exists in specific (c2s or s2s) config
func AccessControl(main gin.HandlerFunc, allowedTokens map[string]bool, errMsg string) gin.HandlerFunc {
	return func(c *gin.Context) {
		iface, ok := c.Get(TokenName)
		if !ok {
			log.Println("System error: token wasn't found in context")
			return
		}

		token := iface.(string)

		if _, ok := allowedTokens[token]; !ok {
			c.Writer.WriteHeader(http.StatusUnauthorized)
			if errMsg != "" {
				c.Writer.Write([]byte(errMsg))
			}
			return
		}

		main(c)
	}
}
