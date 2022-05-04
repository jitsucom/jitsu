package oauth

import (
	"strings"

	"github.com/spf13/viper"
)

var Fields = map[string]map[string]string{
	"source-github": {
		"client_id":     "github.client_id",
		"client_secret": "github.client_secret",
	},
	"source-bing-ads": {
		"client_id":       "bing_ads.client_id",
		"client_secret":   "bing_ads.client_secret",
		"developer_token": "bing_ads.developer_token",
	},
	"tap-adroll": {
		"client_id":     "adroll.client_id",
		"client_secret": "adroll.client_secret",
	},
	"google_analytics": {
		"client_id":     "google_analytics.client_id",
		"client_secret": "google_analytics.client_secret",
	},
	"google_ads": {
		"client_id":       "google_ads.client_id",
		"client_secret":   "google_ads.client_secret",
		"developer_token": "google_ads.developer_token",
	},
	"google_play": {
		"client_id":     "google_play.client_id",
		"client_secret": "google_play.client_secret",
	},
	"tap-google-sheets": {
		"client_id":     "google_sheets.client_id",
		"client_secret": "google_sheets.client_secret",
	},
	"firebase": {
		"client_id":     "firebase.client_id",
		"client_secret": "firebase.client_secret",
	},
	"tap-helpscout": {
		"client_id":     "helpscout.client_id",
		"client_secret": "helpscout.client_secret",
	},
	"tap-xero": {
		"client_id":     "xero.client_id",
		"client_secret": "xero.client_secret",
	},
}

type ConfigService struct{}

func (s *ConfigService) Get(id string) (Secrets, bool) {
	fields, ok := Fields[id]
	if !ok {
		return nil, false
	}

	secret := make(Secrets)
	for key, configKey := range fields {
		value := viper.GetString(configKey)
		secret[key] = SecretValue{
			Value:    value,
			EnvName:  strings.ReplaceAll(strings.ToUpper(configKey), ".", "_"),
			YAMLPath: configKey,
			Provided: value != "",
		}
	}

	return secret, true
}
