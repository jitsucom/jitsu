package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"net/http"
)

type SSOAuthHandler struct {
	authService *authorization.Service
}

func NewSSOAuthHandler(authService *authorization.Service) *SSOAuthHandler {
	return &SSOAuthHandler{
		authService,
	}
}

func (oh *SSOAuthHandler) Handler(c *gin.Context) {
	code := c.Query("code")

	c.Header("content-type", "text/html")

	td, err := oh.authService.SSOAuthenticate(code)
	if err != nil {
		errorTmpl := `<script>
		  window.localStorage.setItem("sso_error", "%s: %v")
		  window.location.href = "/"
		</script>`
		c.String(http.StatusOK, errorTmpl, "SSO Auth error!", err)
		return
	}

	successTmpl := `<script>
	  window.localStorage.setItem("en_access", "%s")
	  window.localStorage.setItem("en_refresh", "%s")
	  window.location.href = "/"
	</script>`
	c.String(http.StatusOK, successTmpl, td.AccessTokenEntity.AccessToken, td.RefreshTokenEntity.RefreshToken)

	return
}
