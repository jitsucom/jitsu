package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

const (
	errorTmpl = `<script>
	  window.localStorage.setItem("sso_error", 'SSO Auth error! %s')
	  window.location.href = "%s"
	</script>`
	successTmpl = `<script>
	  window.localStorage.setItem("en_access", "%s")
	  window.localStorage.setItem("en_refresh", "%s")
	  window.location.href = "%s"
	</script>`
)

type SSOAuthHandler struct {
	Authorizator Authorizator
	Provider     SSOProvider
	UIBaseURL    string
}

func (h *SSOAuthHandler) Handle(ctx *gin.Context) {
	if ctx.IsAborted() {
		return
	}

	ctx.Header("content-type", "text/html")
	if provider := h.Provider; provider == nil {
		ctx.String(http.StatusOK, errorTmpl, "SSO is not configured", h.UIBaseURL)
	} else if authorizator, err := h.Authorizator.Local(); err != nil {
		ctx.String(http.StatusOK, errorTmpl, EscapeError(err), h.UIBaseURL)
	} else if code := ctx.Query("code"); code == "" {
		ctx.String(http.StatusOK, errorTmpl, "Missed required query param: code", h.UIBaseURL)
	} else if session, err := provider.GetSSOSession(ctx, code); err != nil {
		ctx.String(http.StatusOK, errorTmpl, EscapeError(err), h.UIBaseURL)
	} else if tokenPair, err := authorizator.SignInSSO(ctx, provider.Name(), session, provider.AccessTokenTTL()); err != nil {
		ctx.String(http.StatusOK, errorTmpl, EscapeError(err), h.UIBaseURL)
	} else {
		ctx.String(http.StatusOK, successTmpl, tokenPair.AccessToken, tokenPair.RefreshToken, h.UIBaseURL)
	}
}

func EscapeError(error error) string {
	escaped, err := json.Marshal(error.Error())
	if err != nil {
		return "Failed to escape error message"
	}
	return string(escaped)
}
