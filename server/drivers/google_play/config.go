package google_play

import (
	"errors"
	"github.com/jitsucom/jitsu/server/drivers/base"
)

type GooglePlayConfig struct {
	AccountID  string                 `mapstructure:"account_id" json:"account_id,omitempty" yaml:"account_id,omitempty"`
	AccountKey *base.GoogleAuthConfig `mapstructure:"auth" json:"auth,omitempty" yaml:"auth,omitempty"`
}

func (gpc *GooglePlayConfig) Validate() error {
	if gpc == nil {
		return errors.New("GooglePlay config is required")
	}

	if gpc.AccountID == "" {
		return errors.New("GooglePlay account_id is required")
	}

	if gpc.AccountKey == nil {
		return errors.New("GooglePlay 'auth' is required")
	}
	return gpc.AccountKey.Validate()
}
