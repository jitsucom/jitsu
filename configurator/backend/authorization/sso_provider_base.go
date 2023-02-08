package authorization

import "time"

type SSOProviderBase struct {
	SSOConfig *SSOConfig
}

func (sso *SSOProviderBase) AccessTokenTTL() time.Duration {
	return time.Duration(sso.SSOConfig.AccessTokenTTLSeconds) * time.Second
}

func (sso *SSOProviderBase) IsAutoProvisionEnabled() bool {
	return sso.SSOConfig.AutoProvision.Enable
}

func (sso *SSOProviderBase) IsAutoOnboardingEnabled() bool {
	return sso.SSOConfig.AutoProvision.AutoOnboarding
}
