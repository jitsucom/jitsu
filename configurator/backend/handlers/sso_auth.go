package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"net/http"
)

const (
	errorTmpl = `<script>
	  window.localStorage.setItem("sso_error", "SSO Auth error! %v")
	  window.location.href = "/"
	</script>`
	successTmpl = `<script>
	  window.localStorage.setItem("en_access", "%s")
	  window.localStorage.setItem("en_refresh", "%s")
	  window.location.href = "/"
	</script>`
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

	if code == "" {
		c.String(http.StatusOK, errorTmpl, fmt.Errorf("missed required query param: code"))
		return
	}

	td, err := oh.authService.SSOAuthenticate(code)
	if err != nil {
		c.String(http.StatusOK, errorTmpl, err)
		return
	}

	c.String(http.StatusOK, successTmpl, td.AccessTokenEntity.AccessToken, td.RefreshTokenEntity.RefreshToken)

	return
}
