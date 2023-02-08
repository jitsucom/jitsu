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
	BoxyHQConfig          `mapstructure:",squash"`
	Auth0Config           `mapstructure:",squash"`
	Provider              string                 `json:"provider" mapstructure:"provider" validate:"required"`
	AccessTokenTTLSeconds int                    `json:"access_token_ttl_seconds" mapstructure:"access_token_ttl_seconds" validate:"required"`
	AutoProvision         SSOConfigAutoProvision `json:"auto_provision" mapstructure:"auto_provision"`
}

type BoxyHQConfig struct {
	Tenant  string `json:"tenant" mapstructure:"tenant"  validate:"required_if=Provider boxyhq"`
	Product string `json:"product" mapstructure:"product" validate:"required_if=Provider boxyhq"`
	Host    string `json:"host" mapstructure:"host" validate:"required_if=Provider boxyhq"`
}

type Auth0Config struct {
	Domain       string `json:"domain" mapstructure:"domain" validate:"required_if=Provider auth0"`
	ClientId     string `json:"client_id" mapstructure:"client_id" validate:"required_if=Provider auth0"`
	ClientSecret string `json:"client_secret" mapstructure:"client_secret" validate:"required_if=Provider auth0"`
}

type SSOConfigAutoProvision struct {
	Enable         bool `json:"enable" mapstructure:"enable"`
	AutoOnboarding bool `json:"auto_onboarding" mapstructure:"auto_onboarding"`
}

func closeQuietly(closer io.Closer) {
	_ = closer.Close()
}
