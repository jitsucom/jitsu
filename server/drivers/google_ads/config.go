package google_ads

import (
	"errors"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/oauth"
	"github.com/spf13/viper"
	"strconv"
	"time"
)

//googleAdsHTTPConfiguration contains default amplitude HTTP timeouts/retry/delays,etc
var googleAdsHTTPConfiguration = &adapters.HTTPConfiguration{
	GlobalClientTimeout:       10 * time.Minute,
	RetryDelay:                10 * time.Second,
	RetryCount:                0,
	ClientMaxIdleConns:        1000,
	ClientMaxIdleConnsPerHost: 1000,
}

type GoogleAdsConfig struct {
	AuthConfig        *base.GoogleAuthConfig `mapstructure:"auth" json:"auth,omitempty" yaml:"auth,omitempty"`
	CustomerId        string                 `mapstructure:"customer_id" json:"customer_id,omitempty" yaml:"customer_id,omitempty"`
	ManagerCustomerId string                 `mapstructure:"manager_customer_id" json:"manager_customer_id,omitempty" yaml:"manager_customer_id,omitempty"`
	DeveloperToken    string                 `mapstructure:"developer_token" json:"developer_token,omitempty" yaml:"developer_token,omitempty"`
}

type GoogleAdsCollectionConfig struct {
	StartDateStr string `mapstructure:"start_date" json:"start_date,omitempty" yaml:"start_date,omitempty"`
	Fields       string `mapstructure:"fields" json:"fields,omitempty" yaml:"fields,omitempty"`
}

func (gac *GoogleAdsConfig) FillPreconfiguredOauth(sourceType string) {
	oathFields, ok := oauth.Fields[sourceType]
	if ok {
		if developerToken, ok := oathFields["developer_token"]; gac.DeveloperToken == "" && ok {
			gac.DeveloperToken = viper.GetString(developerToken)
		}
		//backward compatibility with previous versions config
		if gac.DeveloperToken == "" && viper.GetString("google-ads.developer-token") != "" {
			gac.DeveloperToken = viper.GetString("google-ads.developer-token")
		}
		gac.AuthConfig.FillPreconfiguredOauth(sourceType)
	}
}

func (gac *GoogleAdsConfig) Validate() error {
	if gac.CustomerId == "" {
		return errors.New("'customer_id' is required.")
	}
	if _, err := strconv.Atoi(gac.CustomerId); err != nil {
		return errors.New("'customer_id' must an integer number.")
	}
	if gac.ManagerCustomerId != "" {
		if _, err := strconv.Atoi(gac.ManagerCustomerId); err != nil {
			return errors.New("'manager_customer_id' must an integer number.")
		}
	}
	if gac.DeveloperToken == "" {
		return errors.New("'developer token' is required.")
	}

	return gac.AuthConfig.Validate()
}
