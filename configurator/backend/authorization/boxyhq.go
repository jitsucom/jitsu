package authorization

import (
	"context"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"
	"time"

	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/jitsucom/jitsu/server/random"
	"github.com/pkg/errors"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

type BoxyHQ struct {
	Config *SSOConfig
}

func (p *BoxyHQ) Name() string {
	return BoxyHQName
}

func (p *BoxyHQ) AccessTokenTTL() time.Duration {
	return time.Duration(p.Config.AccessTokenTTLSeconds) * time.Second
}

func (p *BoxyHQ) GetUser(ctx context.Context, code string) (*handlers.SSOSession, error) {
	conf := &clientcredentials.Config{
		ClientID:     "dummy",
		ClientSecret: "dummy",
		EndpointParams: url.Values{
			"tenant":     {p.Config.Tenant},
			"product":    {p.Config.Product},
			"grant_type": {"authorization_code"},
			"code":       {code},
		},
		TokenURL:  p.Config.Host + "/api/oauth/token",
		AuthStyle: oauth2.AuthStyleInParams,
	}

	token, err := conf.Token(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "get sso token")
	}

	userInfo, err := p.getUserInfo(ctx, conf)
	if err != nil {
		return nil, errors.Wrap(err, "get user info from boxyhq")
	}

	return &handlers.SSOSession{
		UserID:      userInfo.ID,
		Email:       userInfo.Email,
		AccessToken: token.AccessToken,
	}, nil
}

func (p *BoxyHQ) getUserInfo(ctx context.Context, conf *clientcredentials.Config) (*boxyHQUserInfo, error) {
	resp, err := conf.Client(ctx).Get(p.Config.Host + "/api/oauth/userinfo")
	switch {
	case err != nil:
		return nil, err
	case resp.StatusCode != http.StatusOK:
		return nil, errors.Errorf("unexpected status code from boxyhq: %d", resp.StatusCode)
	}

	defer closeQuietly(resp.Body)

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, errors.Wrap(err, "read boxyhq user info response")
	}

	var info boxyHQUserInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, errors.Wrap(err, "unmarshal boxyhq user info")
	}

	return &info, nil
}

func (p *BoxyHQ) AuthLink() string {
	return fmt.Sprintf(
		"%s?response_type=code&provider=saml&client_id=dummy&tenant=%s&product=%s&state=%s",
		p.Config.Host+"/api/oauth/authorize",
		p.Config.Tenant,
		p.Config.Product,
		random.String(10),
	)
}

type boxyHQUserInfo struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}
