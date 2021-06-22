package google_analytics

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
)

type GoogleAnalyticsConfig struct {
	AuthConfig *base.GoogleAuthConfig `mapstructure:"auth" json:"auth,omitempty" yaml:"auth,omitempty"`
	ViewID     string                 `mapstructure:"view_id" json:"view_id,omitempty" yaml:"view_id,omitempty"`
}

type GAReportFieldsConfig struct {
	Dimensions []string `mapstructure:"dimensions" json:"dimensions,omitempty" yaml:"dimensions,omitempty"`
	Metrics    []string `mapstructure:"metrics" json:"metrics,omitempty" yaml:"metrics,omitempty"`
}

func (gac *GoogleAnalyticsConfig) Validate() error {
	if gac.ViewID == "" {
		return fmt.Errorf("view_id field must not be empty")
	}
	return gac.AuthConfig.Validate()
}
