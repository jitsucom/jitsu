package drivers

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"strings"
)

const (
	FbMarketingType     = "facebook_marketing"
	FirebaseType        = "firebase"
	GoogleAnalyticsType = "google_analytics"
	GooglePlayType      = "google_play"
	RedisType           = "redis"

	SingerType = "singer"
)

var errAccountKeyConfiguration = errors.New("service_account_key must be map, JSON file path or JSON content string")
var errAuthorizationConfiguration = errors.New("authorization is not configured. You need to configure " +
	"[service_account_key] field or [client_id, client_secret, refresh_token] set of fields")

type GoogleAuthConfig struct {
	ClientID          string      `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret      string      `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken      string      `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	ServiceAccountKey interface{} `mapstructure:"service_account_key" json:"service_account_key,omitempty" yaml:"service_account_key,omitempty"`
}

func (gac *GoogleAuthConfig) Marshal() ([]byte, error) {
	if gac.ServiceAccountKey != nil {
		switch gac.ServiceAccountKey.(type) {
		case map[string]interface{}:
			return json.Marshal(gac.ServiceAccountKey)
		case string:
			accountKeyFile := gac.ServiceAccountKey.(string)
			if accountKeyFile == "" {
				return nil, errAccountKeyConfiguration
			} else if strings.HasPrefix(accountKeyFile, "{") {
				return []byte(accountKeyFile), nil
			} else {
				return ioutil.ReadFile(accountKeyFile)
			}
		default:
			return nil, errAccountKeyConfiguration
		}
	} else {
		return json.Marshal(gac.ToGoogleAuthJSON())
	}
}

func (gac *GoogleAuthConfig) Validate() error {
	if gac.ServiceAccountKey == nil {
		if gac.ClientID == "" {
			return errAuthorizationConfiguration
		}
		if gac.ClientSecret == "" {
			return errAuthorizationConfiguration
		}
		if gac.RefreshToken == "" {
			return errAuthorizationConfiguration
		}
	}
	return nil
}

type GoogleAuthorizedUserJSON struct {
	ClientID     string `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret string `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken string `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	AuthType     string `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
}

func (gac *GoogleAuthConfig) ToGoogleAuthJSON() GoogleAuthorizedUserJSON {
	return GoogleAuthorizedUserJSON{ClientID: gac.ClientID, ClientSecret: gac.ClientSecret,
		RefreshToken: gac.RefreshToken, AuthType: "authorized_user"}
}
