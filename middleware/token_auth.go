package middleware

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
)

const TokenName = "token"

//extractToken return token from
//1. query parameter
//2. header
//3. dynamic query parameter
func extractToken(r *http.Request) string {
	queryValues := r.URL.Query()
	token := queryValues.Get(TokenName)

	if token == "" {
		token = r.Header.Get("x-auth-token")
	}

	if token == "" {
		for k, v := range r.URL.Query() {
			if strings.HasPrefix(k, "p_") && len(v) > 0 {
				token = v[0]
				break
			}
		}
	}

	return token
}

//TokenAuth check that provided token equals
func TokenAuth(main gin.HandlerFunc, originalToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c.Request)

		if token == originalToken {
			main(c)
		} else {
			c.JSON(http.StatusUnauthorized, ErrorResponse{Message: "Wrong token"})
			/*c.Writer.WriteHeader(http.StatusUnauthorized)
			c.Writer.Write([]byte("Wrong token"))*/
		}
	}
}

//TokenOriginsAuth check that provided token:
//1. is valid
//2. exists in specific (js or api) token config
func TokenFuncAuth(main gin.HandlerFunc, isAllowedOriginsFunc func(string) ([]string, bool), errMsg string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if errMsg == "" {
			errMsg = "Wrong token"
		}
		token := extractToken(c.Request)

		_, allowed := isAllowedOriginsFunc(token)
		if !allowed {
			c.JSON(http.StatusUnauthorized, ErrorResponse{Message: errMsg})
			return
		}

		c.Set(TokenName, token)

		main(c)
	}
}
