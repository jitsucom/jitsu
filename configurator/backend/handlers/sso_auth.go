package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
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
	Authorizator Authorizator
	Provider     SSOProvider
}

func (h *SSOAuthHandler) Handle(ctx *gin.Context) {
	if ctx.IsAborted() {
		return
	}

	ctx.Header("content-type", "text/html")
	if provider := h.Provider; provider == nil {
		ctx.String(http.StatusOK, errorTmpl, errors.New("sso is not configured"))
	} else if code := ctx.Query("code"); code == "" {
		ctx.String(http.StatusOK, errorTmpl, errors.New("missed required query param: code"))
	} else if session, err := provider.GetUser(ctx, code); err != nil {
		ctx.String(http.StatusOK, errorTmpl, err)
	} else if authorizator, err := h.Authorizator.Local(); err != nil {
		ctx.String(http.StatusOK, errorTmpl, err)
	} else if tokenPair, err := authorizator.SignInSSO(ctx, provider.Name(), session, provider.AccessTokenTTL()); err != nil {
		ctx.String(http.StatusOK, errorTmpl, err)
	} else {
		ctx.String(http.StatusOK, successTmpl, tokenPair.AccessToken, tokenPair.RefreshToken)
	}
}
