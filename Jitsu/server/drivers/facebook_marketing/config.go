package facebook_marketing

import (
	"errors"
	"github.com/jitsucom/jitsu/server/drivers/base"
)

type FacebookMarketing struct {
	base.IntervalDriver

	collection   *base.Collection
	config       *FacebookMarketingConfig
	reportConfig *FacebookReportConfig
	version      string
}

type FacebookReportConfig struct {
	Fields []string `mapstructure:"fields" json:"fields,omitempty" yaml:"fields,omitempty"`
	Level  string   `mapstructure:"level" json:"level,omitempty" yaml:"level,omitempty"`
}

type FacebookMarketingConfig struct {
	AccountID   string `mapstructure:"account_id" json:"account_id,omitempty" yaml:"account_id,omitempty"`
	AccessToken string `mapstructure:"access_token" json:"access_token,omitempty" yaml:"access_token,omitempty"`
}

func (fmc *FacebookMarketingConfig) Validate() error {
	if fmc.AccountID == "" {
		return errors.New("account_id is required")
	}
	if fmc.AccessToken == "" {
		return errors.New("access_token is required")
	}
	return nil
}
