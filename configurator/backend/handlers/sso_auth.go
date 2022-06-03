package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/configurator/storages"

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
	Authorizator   Authorizator
	Provider       SSOProvider
	UIBaseURL      string
	Configurations *storages.ConfigurationsService
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
	} else {
		_, err := authorizator.GetUserIDByEmail(ctx, session.Email)
		if err != nil && provider.IsAutoProvisionEnabled() {
			err := h.AutoProvision(ctx, session, authorizator, provider.IsAutoOnboardingEnabled())
			if err != nil {
				ctx.String(http.StatusOK, errorTmpl, EscapeError(err), h.UIBaseURL)
				return
			}
		}

		if tokenPair, err := authorizator.SignInSSO(ctx, provider.Name(), session, provider.AccessTokenTTL()); err != nil {
			ctx.String(http.StatusOK, errorTmpl, EscapeError(err), h.UIBaseURL)
		} else {
			ctx.String(http.StatusOK, successTmpl, tokenPair.AccessToken, tokenPair.RefreshToken, h.UIBaseURL)
		}
	}
}

func (h *SSOAuthHandler) AutoProvision(ctx *gin.Context, sso *SSOSession, authorizator LocalAuthorizator, autoOnboarding bool) (error error) {
	var userName = strings.Split(sso.Email, "@")[0]
	var projectName = userName + "'s project"

	user, err := authorizator.CreateUser(ctx, sso.Email)
	if err != nil {
		return middleware.ReadableError{
			Description: fmt.Sprintf("Cannot create user %s", sso.Email),
			Cause:       err,
		}
	}

	if !autoOnboarding {
		return nil
	}

	var project entities.Project
	req := &openapi.CreateProjectRequest{
		Name: projectName,
	}
	err = h.Configurations.Create(ctx, &project, req)
	if err != nil {
		return middleware.ReadableError{
			Description: "Cannot create new project",
			Cause:       err,
		}
	}

	var onboarded = true
	var requireSetup = false
	_, err = h.Configurations.UpdateUserInfo(ctx, user.ID, openapi.UpdateUserInfoRequest{
		Name:      &userName,
		Onboarded: &onboarded,
		Project: &openapi.ProjectInfoUpdate{
			Id:           &project.Id,
			Name:         &project.Name,
			RequireSetup: &requireSetup,
		},
	})

	if err != nil {
		return middleware.ReadableError{
			Description: "Cannot update user info",
			Cause:       err,
		}
	}

	err = h.Configurations.CreateDefaultAPIKey(ctx, project.Id)
	if err != nil {
		return middleware.ReadableError{
			Description: "Cannot create default api key",
			Cause:       err,
		}
	}

	return nil
}

func EscapeError(error error) string {
	escaped, err := json.Marshal(error.Error())
	if err != nil {
		return "Failed to escape error message"
	}
	return string(escaped)
}
