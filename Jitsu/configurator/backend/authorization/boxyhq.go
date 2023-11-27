package authorization

import (
	"fmt"
	"github.com/carlmjohnson/requests"
	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/server/uuid"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
	"net/http"
	"net/url"
)

type BoxyHQ struct {
	SSOProviderBase
}

func NewBoxyHQ(ssoConfig *SSOConfig) (*BoxyHQ, error) {
	if err := validator.New().Struct(&ssoConfig.BoxyHQConfig); err != nil {
		if err2 := validator.New().Struct(&ssoConfig.LegacyBoxyHQConfig); err2 != nil {
			return nil, fmt.Errorf("missed required SSO config params: %v", err)
		}
		ssoConfig.BoxyHQConfig = ssoConfig.LegacyBoxyHQConfig
	}
	return &BoxyHQ{
		SSOProviderBase: SSOProviderBase{SSOConfig: ssoConfig},
	}, nil
}

func (p *BoxyHQ) Name() string {
	return BoxyHQName
}

func (p *BoxyHQ) GetSSOSession(ctx *gin.Context, code string) (*handlers.SSOSession, error) {
	conf := &clientcredentials.Config{
		ClientID:     "dummy",
		ClientSecret: "dummy",
		EndpointParams: url.Values{
			"tenant":     {p.SSOConfig.Tenant},
			"product":    {p.SSOConfig.Product},
			"grant_type": {"authorization_code"},
			"code":       {code},
		},
		TokenURL:  p.SSOConfig.Host + "/api/oauth/token",
		AuthStyle: oauth2.AuthStyleInParams,
	}

	token, err := conf.Token(ctx)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to get BoxyHQ SSO token",
			Cause:       err,
		}
	}

	var info boxyHQUserInfo
	if err := requests.URL(p.SSOConfig.Host+"/api/oauth/userinfo").
		Header("authorization", "Bearer "+token.AccessToken).
		CheckStatus(http.StatusOK).
		ToJSON(&info).
		Fetch(ctx); err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to load user info from BoxyHQ SSO",
			Cause:       err,
		}
	}

	return &handlers.SSOSession{
		UserID:      info.ID,
		Email:       info.Email,
		AccessToken: token.AccessToken,
	}, nil
}

func (p *BoxyHQ) LoginHandler(ctx *gin.Context) {
	ctx.Redirect(http.StatusTemporaryRedirect, p.AuthLink(ctx))
}

func (p *BoxyHQ) LogoutHandler(ctx *gin.Context) {
	middleware.StatusOk(ctx)
}

func (p *BoxyHQ) AuthLink(ctx *gin.Context) string {
	return fmt.Sprintf(
		"%s?response_type=code&provider=saml&client_id=dummy&tenant=%s&product=%s&state=%s&redirect_uri=%s",
		p.SSOConfig.Host+"/api/oauth/authorize",
		p.SSOConfig.Tenant,
		p.SSOConfig.Product,
		uuid.New(),
		url.QueryEscape(ctx.Query("redirect_uri")),
	)
}

type boxyHQUserInfo struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}
