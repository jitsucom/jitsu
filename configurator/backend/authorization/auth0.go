package authorization

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/coreos/go-oidc"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/jitsucom/jitsu/server/uuid"
	"golang.org/x/oauth2"
	"net/http"
	"net/url"
)

type Auth0 struct {
	SSOProviderBase
	Provider *oidc.Provider
	Config   oauth2.Config
}

// NewAuth0 instantiates the *Authenticator.
func NewAuth0(ssoConfig *SSOConfig) (*Auth0, error) {
	if err := validator.New().Struct(&ssoConfig.Auth0Config); err != nil {
		return nil, fmt.Errorf("missed required SSO config params: %v", err)
	}
	provider, err := oidc.NewProvider(
		context.Background(),
		"https://"+ssoConfig.Domain+"/",
	)

	if err != nil {
		provider, err = oidc.NewProvider(
			context.Background(),
			"https://"+ssoConfig.Domain,
		)

		if err != nil {
			return nil, err
		}
	}

	conf := oauth2.Config{
		ClientID:     ssoConfig.ClientId,
		ClientSecret: ssoConfig.ClientSecret,
		//RedirectURL:  viper.GetString("backend.base_url") + "/api/v1/sso-auth-callback",
		Endpoint: provider.Endpoint(),
		Scopes:   []string{oidc.ScopeOpenID, "profile", "email"},
	}

	return &Auth0{
		SSOProviderBase: SSOProviderBase{SSOConfig: ssoConfig},
		Provider:        provider,
		Config:          conf,
	}, nil
}

func (a *Auth0) Name() string {
	return Auth0Name
}

func (a *Auth0) GetSSOSession(ctx *gin.Context, code string) (*handlers.SSOSession, error) {
	session := sessions.Default(ctx)
	if ctx.Query("state") != session.Get("state") {
		return nil, middleware.ReadableError{
			Description: "Invalid state parameter.",
		}
	}
	if a.Config.RedirectURL == "" {
		rUrl := session.Get("redirect_uri")
		if rUrl != nil {
			a.Config.RedirectURL = rUrl.(string)
		}
	}

	// Exchange an authorization code for a token.
	token, err := a.Config.Exchange(ctx.Request.Context(), code)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to exchange an authorization code for a token.",
		}
	}

	idToken, err := a.VerifyIDToken(ctx.Request.Context(), token)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to verify ID Token.",
		}
	}

	var profile map[string]interface{}
	if err := idToken.Claims(&profile); err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to load user profile.",
			Cause:       err,
		}
	}

	logging.Infof("Auth0 profile: %+v", profile)
	email := utils.MapNVLKeys(profile, "", "email").(string)
	if email == "" {
		return nil, middleware.ReadableError{
			Description: "Failed to get email from profile. Email is required.",
		}
	}
	emailVerified := fmt.Sprint(utils.MapNVLKeys(profile, false, "email_verified"))
	if emailVerified != "true" && !a.SSOConfig.AllowUnverifiedEmail {
		return nil, middleware.ReadableError{
			Description: "Email is not verified. Please verify your email.",
		}
	}
	return &handlers.SSOSession{
		UserID:      utils.MapNVLKeys(profile, uuid.New(), "sub", "email").(string),
		Email:       email,
		AccessToken: token.AccessToken,
		Profile:     profile,
	}, nil
}

func (a *Auth0) LoginHandler(ctx *gin.Context) {
	state, err := generateRandomState()
	if err != nil {
		ctx.String(http.StatusInternalServerError, err.Error())
		return
	}

	// Save the state inside the session.
	session := sessions.Default(ctx)
	session.Set("state", state)
	a.Config.RedirectURL = ctx.Query("redirect_uri")
	session.Set("redirect_uri", a.Config.RedirectURL)
	if err := session.Save(); err != nil {
		ctx.String(http.StatusInternalServerError, err.Error())
		return
	}

	ctx.Redirect(http.StatusTemporaryRedirect, a.Config.AuthCodeURL(state))
}

func (a *Auth0) LogoutHandler(ctx *gin.Context) {
	logoutUrl, err := url.Parse("https://" + a.SSOConfig.Domain + "/v2/logout")
	if err != nil {
		ctx.String(http.StatusInternalServerError, err.Error())
		return
	}

	//originalUrl := ctx.Request.URL

	parameters := url.Values{}
	//parameters.Add("returnTo", viper.GetString("backend.base_url")+originalUrl.Path+"?final=1")
	parameters.Add("client_id", a.SSOConfig.ClientId)
	logoutUrl.RawQuery = parameters.Encode()

	ctx.JSON(http.StatusOK, gin.H{"sso_logout_url": logoutUrl.String()})
}

// VerifyIDToken verifies that an *oauth2.Token is a valid *oidc.IDToken.
func (a *Auth0) VerifyIDToken(ctx context.Context, token *oauth2.Token) (*oidc.IDToken, error) {
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return nil, errors.New("no id_token field in oauth2 token")
	}

	oidcConfig := &oidc.Config{
		ClientID: a.SSOConfig.ClientId,
	}

	return a.Provider.Verifier(oidcConfig).Verify(ctx, rawIDToken)
}

func generateRandomState() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}

	state := base64.StdEncoding.EncodeToString(b)

	return state, nil
}
