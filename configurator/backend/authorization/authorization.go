package authorization

import (
	"io"

	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/pkg/errors"
)

const (
	BoxyHQName = "boxyhq"
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
	Provider              string `json:"provider" validate:"required"`
	Tenant                string `json:"tenant" validate:"required"`
	Product               string `json:"product" validate:"required"`
	Host                  string `json:"host" validate:"required"`
	AccessTokenTTLSeconds int    `json:"access_token_ttl_seconds" validate:"required"`
}

func closeQuietly(closer io.Closer) {
	_ = closer.Close()
}
