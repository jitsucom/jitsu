package drivers

import (
	"encoding/json"
	"errors"
	"fmt"
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

	GoogleOAuthAuthorizationType = "OAuth"
)

var errAccountKeyConfiguration = errors.New("service_account_key must be an object, JSON file path or JSON content string")

type GoogleAuthConfig struct {
	Type              string      `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	ClientID          string      `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret      string      `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken      string      `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	ServiceAccountKey interface{} `mapstructure:"service_account_key" json:"service_account_key,omitempty" yaml:"service_account_key,omitempty"`
}

func (gac *GoogleAuthConfig) Marshal() ([]byte, error) {
	if gac.Type == GoogleOAuthAuthorizationType {
		return json.Marshal(gac.ToGoogleAuthJSON())
	}

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
}

//Validate checks service account JSON or OAuth fields
//returns err if both authorization parameters are empty
func (gac *GoogleAuthConfig) Validate() error {
	if gac.Type == GoogleOAuthAuthorizationType {
		//validate OAuth field
		if gac.ClientID == "" {
			return errors.New("'client_id' is required for Google OAuth authorization")
		}
		if gac.ClientSecret == "" {
			return errors.New("'client_secret' is required for Google OAuth authorization")
		}
		if gac.RefreshToken == "" {
			return errors.New("'refresh_token' is required for Google OAuth authorization")
		}

		return nil
	}

	if gac.ServiceAccountKey == nil || fmt.Sprint(gac.ServiceAccountKey) == "{}" {
		return errors.New("Google authorization is not configured. Plesae configure [service_account_key] field or [client_id, client_secret, refresh_token] set of fields")
	}

	return nil
}

//GoogleAuthorizedUserJSON is a Google dto for authorization
type GoogleAuthorizedUserJSON struct {
	ClientID     string `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret string `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken string `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	AuthType     string `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
}

//ToGoogleAuthJSON returns configured GoogleAuthorizedUserJSON structure for Google authorization
func (gac *GoogleAuthConfig) ToGoogleAuthJSON() GoogleAuthorizedUserJSON {
	return GoogleAuthorizedUserJSON{
		ClientID:     gac.ClientID,
		ClientSecret: gac.ClientSecret,
		RefreshToken: gac.RefreshToken,
		AuthType:     "authorized_user",
	}
}
