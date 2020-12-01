package drivers

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"strings"
)

const (
	GooglePlayType      = "google_play"
	FirebaseType        = "firebase"
	GoogleAnalyticsType = "google_analytics"
)

type GoogleAuthConfig struct {
	ClientId          string      `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
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
				return nil, errors.New("GooglePlay key file is required parameter")
			} else if strings.HasPrefix(accountKeyFile, "{") {
				return []byte(accountKeyFile), nil
			} else {
				return ioutil.ReadFile(accountKeyFile)
			}
		default:
			return nil, errors.New("GooglePlay account key must be map, JSON file path or JSON content string")
		}
	} else {
		return json.Marshal(gac.ToGoogleAuthJSON())
	}
}

type GoogleAuthorizedUserJSON struct {
	ClientId     string `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret string `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken string `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	AuthType     string `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
}

func (gac *GoogleAuthConfig) ToGoogleAuthJSON() GoogleAuthorizedUserJSON {
	return GoogleAuthorizedUserJSON{ClientId: gac.ClientId, ClientSecret: gac.ClientSecret,
		RefreshToken: gac.RefreshToken, AuthType: "authorized_user"}
}
