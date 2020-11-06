package middleware

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

const AdminTokenErr = "Admin token does not match"

type AdminToken struct {
	Token string
}

func (a *AdminToken) AdminAuth(main gin.HandlerFunc, errMsg string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if a.Token == "" {
			c.JSON(http.StatusUnauthorized, ErrorResponse{Message: "admin_token must be configured"})
			return
		}
		token := c.GetHeader("X-Admin-Token")
		if token != a.Token {
			c.JSON(http.StatusUnauthorized, ErrorResponse{Message: errMsg})
			return
		}
		main(c)
	}
}
