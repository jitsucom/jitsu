package middleware

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

const (
	AdminTokenErr = "Admin token does not match"
	AdminTokenKey = "X-Admin-Token"
)

type AdminToken struct {
	Token string
}

func (a *AdminToken) AdminAuth(main gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		if a.Token == "" {
			c.JSON(http.StatusUnauthorized, ErrResponse("admin_token must be configured", nil))
			return
		}

		token := c.Query(TokenName)
		if token == "" {
			token = c.GetHeader(AdminTokenKey)
		}

		if token != a.Token {
			c.JSON(http.StatusUnauthorized, ErrResponse(AdminTokenErr, nil))
			return
		}
		main(c)
	}
}
