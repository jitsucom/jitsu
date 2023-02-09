package authorization

import (
	"github.com/jitsucom/jitsu/server/utils"
	"time"
)

type SSOProviderBase struct {
	SSOConfig *SSOConfig
}

func (sso *SSOProviderBase) AccessTokenTTL() time.Duration {
	return time.Duration(utils.NvlInt(sso.SSOConfig.AccessTokenTTLSeconds, 86400)) * time.Second
}

func (sso *SSOProviderBase) IsAutoProvisionEnabled() bool {
	return sso.SSOConfig.AutoProvision.Enable
}

func (sso *SSOProviderBase) IsAutoOnboardingEnabled() bool {
	return sso.SSOConfig.AutoProvision.AutoOnboarding
}
