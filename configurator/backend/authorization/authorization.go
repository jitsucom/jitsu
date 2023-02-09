package authorization

import (
	"io"

	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/pkg/errors"
)

const (
	BoxyHQName = "boxyhq"
	Auth0Name  = "auth0"
)

var (
	ErrUserExists    = handlers.ErrUserExists
	errIsLocal       = errors.New("This API call is supported only for Firebase-based authorization")
	errIsCloud       = errors.New("This API call is supported only for Redis-based authorization")
	errUserNotFound  = errors.New("User is not found")
	errMultipleUsers = errors.New("Multiple users found. Please use your own personal access token for this API call")
)

type MailSender interface {
	IsConfigured() bool
	SendResetPassword(email, link string) error
	SendAccountCreated(email, link string) error
}

type SSOConfig struct {
	//for compatibility with previous version where boxyhq config was in root
	LegacyBoxyHQConfig BoxyHQConfig `mapstructure:",squash" validate:"-"`
	BoxyHQConfig       `json:"boxyhq" mapstructure:"boxyhq" validate:"-"`
	Auth0Config        `json:"auth0" mapstructure:"auth0" validate:"-"`

	Provider              string                 `json:"provider" mapstructure:"provider" validate:"required"`
	AccessTokenTTLSeconds int                    `json:"access_token_ttl_seconds" mapstructure:"access_token_ttl_seconds" validate:"required"`
	AutoProvision         SSOConfigAutoProvision `json:"auto_provision" mapstructure:"auto_provision"`
}

type BoxyHQConfig struct {
	Tenant  string `json:"tenant" mapstructure:"tenant"  validate:"required"`
	Product string `json:"product" mapstructure:"product" validate:"required"`
	Host    string `json:"host" mapstructure:"host" validate:"required"`
}

type Auth0Config struct {
	Domain               string `json:"domain" mapstructure:"domain" validate:"required"`
	ClientId             string `json:"client_id" mapstructure:"client_id" validate:"required"`
	ClientSecret         string `json:"client_secret" mapstructure:"client_secret" validate:"required"`
	AllowUnverifiedEmail bool   `json:"allow_unverified_email" mapstructure:"allow_unverified_email"`
}

type SSOConfigAutoProvision struct {
	Enable         bool `json:"enable" mapstructure:"enable"`
	AutoOnboarding bool `json:"auto_onboarding" mapstructure:"auto_onboarding"`
}

func closeQuietly(closer io.Closer) {
	_ = closer.Close()
}
